import { generateObject } from "ai";
import { z } from "zod";
import { sqlGenModel } from "../llm";
import { renderRawSchemaForPrompt } from "../schema";
import { withRetry } from "../retry";
import { executeGuardedSql, extractSingleValue } from "./execute";
import type { PipelineResult } from "./types";

const PlanSchema = z.object({
  sql: z.string().describe("A single read-only PostgreSQL SELECT statement. Alias the primary numeric result column as `value` when the question asks for one number."),
  metrics_used: z.array(z.string()).describe("Short names you'd call the metric(s) this query computes."),
  source_tables: z.array(z.string()).describe("Physical table names the query reads from."),
  explanation: z.string().describe("One sentence explaining how the query answers the question."),
});

/**
 * The naive baseline: LLM -> raw SQL. The model is handed the full physical
 * schema directly and must invent its own understanding of relationships,
 * business definitions (e.g. "churn") and metric formulas with no semantic
 * layer and no permission scoping. This is what most "chat with your
 * database" tools ship today.
 */
export async function runRawPipeline(question: string): Promise<PipelineResult> {
  const t0 = Date.now();
  const prompt = `You are a text-to-SQL assistant for a PostgreSQL analytics database. Here is the full schema:

${renderRawSchemaForPrompt()}

Business question: "${question}"

Write ONE syntactically valid, read-only PostgreSQL SELECT statement that answers it (CTEs via one WITH clause at the very start are fine; if you UNION multiple period comparisons, wrap each branch in parentheses). Alias the single primary result number as \`value\` when applicable. You are not given any business definitions (e.g. what counts as "churn") - infer them yourself from column names.`;

  const result = await withRetry(() =>
    generateObject({ model: sqlGenModel, schema: PlanSchema, prompt, maxOutputTokens: 3000 })
  );

  // Same execution backstop as the semantic pipeline (role=null => only the
  // hard schema-hallucination check applies, no permission scoping), so the
  // comparison isn't confounded by different execution safety nets.
  const exec = await executeGuardedSql(result.object.sql, null);
  const returnedValue = exec.sqlSuccess ? extractSingleValue(exec.rows) : null;

  return {
    pipeline: "raw",
    answer: exec.sqlSuccess ? result.object.explanation : `Query failed: ${exec.sqlError}`,
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
