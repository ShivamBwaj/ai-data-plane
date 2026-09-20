import { sqlReadonly } from "../db";
import { guardSql } from "../sql-guard";
import type { Role } from "../permissions";

export interface ExecOutcome {
  sqlSuccess: boolean;
  sqlError: string | null;
  schemaHallucination: boolean;
  permissionViolation: boolean;
  rows: Record<string, unknown>[];
  rowsScanned: number;
}

interface ExplainNode {
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  Plans?: ExplainNode[];
}

function sumScannedRows(node: ExplainNode): number {
  const here = (node["Actual Rows"] ?? 0) * (node["Actual Loops"] ?? 1);
  const children = (node.Plans ?? []).reduce((acc, c) => acc + sumScannedRows(c), 0);
  return here + children;
}

/** Validates `sql` against the physical schema + role, then executes it read-only. Never throws. */
export async function executeGuardedSql(sql: string, role: Role | null): Promise<ExecOutcome> {
  const guard = guardSql(sql, role);
  if (!guard.ok) {
    return {
      sqlSuccess: false,
      sqlError: guard.errors.join(" "),
      schemaHallucination: guard.schemaHallucination,
      permissionViolation: guard.permissionViolation,
      rows: [],
      rowsScanned: 0,
    };
  }

  try {
    const rows = (await sqlReadonly.unsafe(sql)) as unknown as Record<string, unknown>[];
    let rowsScanned = rows.length;
    try {
      const plan = (await sqlReadonly.unsafe(
        `explain (analyze, format json) ${sql}`
      )) as unknown as { "QUERY PLAN": ExplainNode[] }[];
      const root = plan[0]?.["QUERY PLAN"]?.[0];
      if (root) rowsScanned = Math.max(sumScannedRows(root), rows.length);
    } catch {
      // best-effort stat only
    }
    return {
      sqlSuccess: true,
      sqlError: null,
      schemaHallucination: false,
      permissionViolation: false,
      rows: rows.slice(0, 500),
      rowsScanned,
    };
  } catch (e) {
    return {
      sqlSuccess: false,
      sqlError: (e as Error).message,
      schemaHallucination: false,
      permissionViolation: false,
      rows: [],
      rowsScanned: 0,
    };
  }
}

export function extractSingleValue(rows: Record<string, unknown>[]): number | null {
  if (rows.length === 0) return null;
  const row = rows[0];
  const candidate = "value" in row ? row.value : Object.values(row)[0];
  const n = typeof candidate === "string" ? Number(candidate) : (candidate as number);
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}
