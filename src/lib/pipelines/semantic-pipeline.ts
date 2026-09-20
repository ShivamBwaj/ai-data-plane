import { generateObject } from "ai";
import { z } from "zod";
import { sqlGenModel } from "../llm";
import { getRole } from "../permissions";
import { retrieveRelevant } from "../semantic/retrieval";
import { withRetry } from "../retry";
import { executeGuardedSql, extractSingleValue } from "./execute";
import type { PipelineResult } from "./types";

const PlanSchema = z.object({
  sql: z.string().describe("A single read-only PostgreSQL SELECT statement. Alias the primary numeric result column as `value` when the question asks for one number."),
  metrics_used: z.array(z.string()).describe("Canonical metric names (from the provided metric catalogue) that this query answers. Empty array if none apply."),
  source_tables: z.array(z.string()).describe("Physical table names the query reads from."),
  explanation: z.string().describe("One sentence explaining how the query answers the question, for a non-technical business user."),
});

/**
 * The AI Data Plane path: retrieve relevant semantic-layer context (entities,
 * metric definitions, glossary) scoped to the caller's role, then ask the
 * model to plan SQL strictly in terms of that context. The generated SQL is
 * still independently guarded against the real schema + role before it runs.
 */
export async function runSemanticPipeline(question: string, roleId: string): Promise<PipelineResult> {
  const t0 = Date.now();
  const role = getRole(roleId);
  const retrieved = await withRetry(() => retrieveRelevant(question, 10));

  const visibleRetrieved = retrieved.filter((r) => {
    if (r.kind !== "entity") return true;
    const table = r.definition.table as string;
    return role.allowedTables.includes(table);
  });

  const context = visibleRetrieved
    .map((r) => `[${r.kind}] ${r.name}: ${r.description}\n  definition: ${JSON.stringify(r.definition)}`)
    .join("\n");

  const columnNote = Object.entries(role.allowedColumns ?? {})
    .map(([t, cols]) => `On table ${t}, only these columns are visible: ${cols.join(", ")}.`)
    .join(" ");
  const rowFilterNote = (role.rowFilters ?? [])
    .map((f) => `Every query MUST filter ${f.table}.${f.column} = '${f.value}' (${f.description})`)
    .join(" ");

  const prompt = `You are the query-planning layer of an AI Data Plane. You do NOT see the raw database schema directly - you only know the business concepts, metrics and relationships retrieved below by the semantic layer for this specific question. Use ONLY the tables/columns mentioned in this context.

Role: ${role.label}. Allowed tables: ${role.allowedTables.join(", ")}. ${columnNote} ${rowFilterNote}

Relevant semantic layer context (retrieved via embedding similarity for this question):
${context}

Business question: "${question}"

Write ONE syntactically valid PostgreSQL statement that answers it, using the metric SQL patterns above as ground truth for how each metric is computed. It must be a single top-level SELECT (CTEs via one WITH clause at the very start are fine; if you UNION multiple period comparisons, wrap each branch in parentheses). Alias the single primary result number as \`value\` when applicable.`;

  const result = await withRetry(() =>
    generateObject({ model: sqlGenModel, schema: PlanSchema, prompt, maxOutputTokens: 3000 })
  );

  const exec = await executeGuardedSql(result.object.sql, role);
  const returnedValue = exec.sqlSuccess ? extractSingleValue(exec.rows) : null;

  return {
    pipeline: "semantic",
    answer: exec.sqlSuccess
      ? result.object.explanation
      : `Could not produce a safe answer: ${exec.sqlError}`,
    sql: result.object.sql,
    metrics_used: result.object.metrics_used,
    source_tables: result.object.source_tables,
    rows_scanned: exec.rowsScanned,
    latency_ms: Date.now() - t0,
    prompt_tokens: result.usage?.inputTokens ?? 0,
    completion_tokens: result.usage?.outputTokens ?? 0,
    sql_success: exec.sqlSuccess,
    sql_error: exec.sqlError,
    schema_hallucination: exec.schemaHallucination,
    permission_violation: exec.permissionViolation,
    returned_value: returnedValue,
    rows: exec.rows,
  };
}
