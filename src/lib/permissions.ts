// Permission layer: role -> which tables/columns the planner is even allowed to
// see or touch, plus optional mandatory row filters.
//
// Enforcement model:
//  - table/column access is HARD-enforced: sql-guard.ts parses the generated
//    SQL's AST and rejects any reference outside the role's allow-list.
//  - row filters are enforced by (a) instructing the planner it MUST add the
//    predicate, and (b) sql-guard checking the predicate's column/value
//    literally appears in a WHERE/JOIN..ON clause before execution.

export interface RowFilter {
  table: string;
  column: string;
  op: "=";
  value: string;
  description: string;
}

export interface Role {
  id: string;
  label: string;
  description: string;
  allowedTables: string[];
  /** table -> allowed columns. Omit a table here (but include in allowedTables) to allow all its columns. */
  allowedColumns?: Record<string, string[]>;
  rowFilters?: RowFilter[];
}

export const ROLES: Record<string, Role> = {
  admin: {
    id: "admin",
    label: "Admin (full access)",
    description: "Unrestricted access to every table and column, no row filters.",
    allowedTables: ["customers", "products", "subscriptions", "transactions", "support_tickets"],
  },
  analyst: {
    id: "analyst",
    label: "Analyst (PII masked)",
    description:
      "Full read access to business data for analytics, but customer name/email are masked out entirely.",
    allowedTables: ["customers", "products", "subscriptions", "transactions", "support_tickets"],
    allowedColumns: {
      customers: ["id", "signup_date", "region", "segment", "plan_tier"],
    },
  },
  support_agent: {
    id: "support_agent",
    label: "Support agent",
    description:
      "Can see tickets and non-financial customer attributes only. No access to subscriptions/transactions/revenue.",
    allowedTables: ["customers", "support_tickets"],
    allowedColumns: {
      customers: ["id", "region", "segment", "plan_tier"],
    },
  },
  regional_manager_na: {
    id: "regional_manager_na",
    label: "Regional manager (NA only)",
    description: "Same access as an analyst, but every query must be scoped to the NA region.",
    allowedTables: ["customers", "products", "subscriptions", "transactions", "support_tickets"],
    allowedColumns: {
      customers: ["id", "signup_date", "region", "segment", "plan_tier"],
    },
    rowFilters: [
      {
        table: "customers",
        column: "region",
        op: "=",
        value: "NA",
        description: "Restrict to customers.region = 'NA'.",
      },
    ],
  },
};

export function getRole(roleId: string): Role {
  return ROLES[roleId] ?? ROLES.admin;
}
