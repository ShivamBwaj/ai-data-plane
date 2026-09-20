// Ground-truth description of the physical database. Used by:
//  - the SQL guard, to detect schema hallucination (tables/columns that don't exist)
//  - the RAW baseline pipeline, which is handed this whole thing as its only context
//  - the semantic layer, which maps business concepts onto these physical tables

export interface ColumnDef {
  name: string;
  type: string;
  pii?: boolean;
  financial?: boolean;
}

export interface TableDef {
  name: string;
  description: string;
  columns: ColumnDef[];
}

export const PHYSICAL_SCHEMA: TableDef[] = [
  {
    name: "customers",
    description: "One row per customer account.",
    columns: [
      { name: "id", type: "integer" },
      { name: "name", type: "text", pii: true },
      { name: "email", type: "text", pii: true },
      { name: "signup_date", type: "date" },
      { name: "region", type: "text" },
      { name: "segment", type: "text" },
      { name: "plan_tier", type: "text" },
    ],
  },
  {
    name: "products",
    description: "Sellable products/plans/add-ons.",
    columns: [
      { name: "id", type: "integer" },
      { name: "name", type: "text" },
      { name: "category", type: "text" },
      { name: "price", type: "numeric" },
      { name: "sku", type: "text" },
    ],
  },
  {
    name: "subscriptions",
    description:
      "One row per subscription a customer holds to a product. status/end_date capture cancellation.",
    columns: [
      { name: "id", type: "integer" },
      { name: "customer_id", type: "integer" },
      { name: "product_id", type: "integer" },
      { name: "start_date", type: "date" },
      { name: "end_date", type: "date" },
      { name: "status", type: "text" },
      { name: "plan_tier", type: "text" },
      { name: "mrr", type: "numeric", financial: true },
    ],
  },
  {
    name: "transactions",
    description: "Charges, refunds and credits against a customer/subscription.",
    columns: [
      { name: "id", type: "integer" },
      { name: "customer_id", type: "integer" },
      { name: "subscription_id", type: "integer" },
      { name: "amount", type: "numeric", financial: true },
      { name: "transaction_date", type: "date" },
      { name: "type", type: "text" },
    ],
  },
  {
    name: "support_tickets",
    description: "Support tickets filed by customers.",
    columns: [
      { name: "id", type: "integer" },
      { name: "customer_id", type: "integer" },
      { name: "created_at", type: "date" },
      { name: "resolved_at", type: "date" },
      { name: "category", type: "text" },
      { name: "priority", type: "text" },
      { name: "satisfaction_score", type: "integer" },
    ],
  },
];

export const TABLE_NAMES = new Set(PHYSICAL_SCHEMA.map((t) => t.name));

export function columnSet(table: string): Set<string> | undefined {
  const t = PHYSICAL_SCHEMA.find((t) => t.name === table);
  return t ? new Set(t.columns.map((c) => c.name)) : undefined;
}

/** Renders the full raw DDL-ish schema text handed to the RAW baseline pipeline. */
export function renderRawSchemaForPrompt(): string {
  return PHYSICAL_SCHEMA.map((t) => {
    const cols = t.columns.map((c) => `  ${c.name} ${c.type}`).join("\n");
    return `table ${t.name} (\n${cols}\n) -- ${t.description}`;
  }).join("\n\n");
}
