import { Parser } from "node-sql-parser";
import { TABLE_NAMES, columnSet } from "./schema";
import type { Role } from "./permissions";

const parser = new Parser();

interface WithEntry {
  name?: { value?: string };
  stmt?: {
    columns?: {
      as?: string | null;
      expr?: { type?: string; column?: string | { expr?: { value?: string } } };
    }[];
  };
}

export interface GuardResult {
  ok: boolean;
  /** True as soon as any referenced table/column doesn't exist in the physical schema at all. */
  schemaHallucination: boolean;
  /** True as soon as a referenced table/column exists but is outside the role's allow-list, or a required row filter is missing. */
  permissionViolation: boolean;
  tables: string[];
  errors: string[];
}

function walk(node: unknown, fn: (n: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, fn);
    return;
  }
  fn(node as Record<string, unknown>);
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (v && typeof v === "object") walk(v, fn);
  }
}

function hasRowFilterPredicate(ast: unknown, table: string, column: string, value: string): boolean {
  let found = false;
  walk(ast, (n) => {
    if (found) return;
    if (n.type === "binary_expr" && (n.operator === "=" || n.operator === "IN")) {
      const left = n.left as Record<string, unknown> | undefined;
      const right = n.right as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const colMatches =
        left?.type === "column_ref" &&
        (left.table === null || left.table === undefined || typeof left.table === "string") &&
        (left.column as { expr?: { value?: string } } | string) &&
        (typeof left.column === "string"
          ? left.column === column
          : (left.column as { expr?: { value?: string } })?.expr?.value === column);
      if (!colMatches) return;
      const values = Array.isArray(right) ? right : [right];
      const valueMatches = values.some((v) => (v as { value?: unknown })?.value === value);
      if (valueMatches) found = true;
    }
  });
  return found;
}

/**
 * Parses `sql`, and validates it against both the real physical schema
 * (hallucination check) and the caller's Role (permission check). Only
 * SELECT is ever permitted - no DDL/DML, no multi-statement payloads.
 */
export function guardSql(sql: string, role: Role | null): GuardResult {
  const errors: string[] = [];
  let ast;
  try {
    const parsed = parser.astify(sql, { database: "postgresql" });
    ast = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return {
      ok: false,
      schemaHallucination: false,
      permissionViolation: false,
      tables: [],
      errors: [`SQL failed to parse: ${(e as Error).message}`],
    };
  }

  if (ast.length !== 1 || ast[0].type !== "select") {
    return {
      ok: false,
      schemaHallucination: false,
      permissionViolation: true,
      tables: [],
      errors: ["Only a single SELECT statement is permitted."],
    };
  }

  let tableList: string[] = [];
  let columnList: string[] = [];
  try {
    tableList = parser.tableList(sql, { database: "postgresql" });
    columnList = parser.columnList(sql, { database: "postgresql" });
  } catch (e) {
    errors.push(`Could not extract table/column list: ${(e as Error).message}`);
  }

  // node-sql-parser's tableList/columnList are WITH-clause-blind: a CTE's name
  // shows up indistinguishable from a real table (e.g. `with total as (...)
  // select ... from total` reports "total" as a referenced table, and columns
  // selected from it as belonging to table "total"). We must exclude CTE
  // names from both hallucination and permission checks - they're aliases to
  // a derived result, not physical tables; the tables/columns the CTE itself
  // reads from are still reported separately (flattened into the same lists)
  // and so are still fully checked.
  const withClause = (ast[0] as { with?: WithEntry[] | null }).with ?? [];
  const cteNames = new Set(
    withClause.map((w) => w.name?.value).filter((n): n is string => Boolean(n))
  );

  // A CTE's SELECT list defines its own output "columns" (e.g. `... AS value`,
  // `... AS n`), which the outer query then selects unqualified (`select value
  // from x`). node-sql-parser has no notion of this - it just reports "value"
  // as a column reference with an unresolvable table, indistinguishable from a
  // genuinely hallucinated physical column. We collect every CTE's output
  // aliases so the unresolved-column check below can tell the two apart.
  const cteOutputColumns = new Set<string>();
  for (const cte of withClause) {
    const cols = cte.stmt?.columns;
    if (!Array.isArray(cols)) continue;
    for (const c of cols) {
      if (typeof c.as === "string") {
        cteOutputColumns.add(c.as);
      } else if (c.expr?.type === "column_ref") {
        const name = typeof c.expr.column === "string" ? c.expr.column : c.expr.column?.expr?.value;
        if (name) cteOutputColumns.add(name);
      }
    }
  }

  const tables = Array.from(
    new Set(
      tableList
        .map((t) => t.split("::")[2])
        .filter((t): t is string => Boolean(t) && !cteNames.has(t))
    )
  );

  let schemaHallucination = false;
  for (const t of tables) {
    if (!TABLE_NAMES.has(t)) {
      schemaHallucination = true;
      errors.push(`References unknown table "${t}".`);
    }
  }

  // node-sql-parser represents a `SELECT *` column as the literal string
  // "(.*)" rather than omitting it - never a real column name to validate.
  const STAR = "(.*)";

  for (const entry of columnList) {
    const [, tbl, col] = entry.split("::");
    if (col === STAR) continue;
    if (tbl && cteNames.has(tbl)) continue;
    if (tbl && tbl !== "null") {
      const cols = columnSet(tbl);
      if (cols && !cols.has(col)) {
        schemaHallucination = true;
        errors.push(`Table "${tbl}" has no column "${col}".`);
      }
    } else if (!cteOutputColumns.has(col)) {
      // Unresolved table - check the column exists on ANY known table.
      const existsSomewhere = tables.some((t) => columnSet(t)?.has(col));
      if (!existsSomewhere) {
        schemaHallucination = true;
        errors.push(`References unknown column "${col}".`);
      }
    }
  }

  let permissionViolation = false;
  if (role) {
    for (const t of tables) {
      if (!role.allowedTables.includes(t)) {
        permissionViolation = true;
        errors.push(`Role "${role.id}" does not have access to table "${t}".`);
      }
    }
    for (const entry of columnList) {
      const [, tbl, col] = entry.split("::");
      if (tbl && cteNames.has(tbl)) continue;
      if (col === STAR) {
        // `SELECT *` (or `t.*`) expands to every column of its table(s), so
        // it must be denied outright against any column-restricted table -
        // there's no way to know which disallowed columns it would expose.
        const starTables = tbl && tbl !== "null" ? [tbl] : tables;
        for (const t of starTables) {
          if (role.allowedColumns?.[t]) {
            permissionViolation = true;
            errors.push(`Role "${role.id}" cannot SELECT * from column-restricted table "${t}".`);
          }
        }
        continue;
      }
      // node-sql-parser only resolves a column's table when it's explicitly
      // qualified (e.g. `c.region`). An unqualified column (e.g. `email`)
      // comes back with table "null" even in a single-table query - so we
      // must resolve it ourselves against every table actually referenced,
      // and deny it if ANY candidate table restricts that column.
      const candidates = tbl && tbl !== "null" ? [tbl] : tables.filter((t) => columnSet(t)?.has(col));
      for (const t of candidates) {
        if (role.allowedColumns?.[t] && !role.allowedColumns[t].includes(col)) {
          permissionViolation = true;
          errors.push(`Role "${role.id}" does not have access to column "${t}.${col}".`);
        }
      }
    }
    for (const rf of role.rowFilters ?? []) {
      if (tables.includes(rf.table) && !hasRowFilterPredicate(ast[0], rf.table, rf.column, rf.value)) {
        permissionViolation = true;
        errors.push(`Missing required row filter: ${rf.description}`);
      }
    }
  }

  return {
    ok: !schemaHallucination && !permissionViolation,
    schemaHallucination,
    permissionViolation,
    tables,
    errors,
  };
}
