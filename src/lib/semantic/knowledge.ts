import { PHYSICAL_SCHEMA } from "../schema";
import { METRIC_TEMPLATES } from "./metrics";

export type SemanticKind = "entity" | "metric" | "glossary";

export interface SemanticEntry {
  kind: SemanticKind;
  name: string;
  description: string;
  /** Structured payload injected verbatim into the planner prompt when this entry is retrieved. */
  definition: Record<string, unknown>;
}

const ENTITY_ENTRIES: SemanticEntry[] = PHYSICAL_SCHEMA.map((t) => ({
  kind: "entity" as const,
  name: t.name,
  description: `${t.name}: ${t.description} Columns: ${t.columns.map((c) => c.name).join(", ")}.`,
  definition: {
    table: t.name,
    columns: t.columns.map((c) => c.name),
    relationships:
      {
        customers: ["subscriptions.customer_id -> customers.id", "transactions.customer_id -> customers.id", "support_tickets.customer_id -> customers.id"],
        subscriptions: ["subscriptions.customer_id -> customers.id", "subscriptions.product_id -> products.id", "transactions.subscription_id -> subscriptions.id"],
        transactions: ["transactions.customer_id -> customers.id", "transactions.subscription_id -> subscriptions.id"],
        support_tickets: ["support_tickets.customer_id -> customers.id"],
        products: ["subscriptions.product_id -> products.id"],
      }[t.name] ?? [],
  },
}));

// De-duplicate metric templates by metricName for the concept catalogue (several
// templates share a metricName with different filter dimensions).
const seenMetric = new Set<string>();
const METRIC_ENTRIES: SemanticEntry[] = [];
for (const t of METRIC_TEMPLATES) {
  const key = t.metricName;
  METRIC_ENTRIES.push({
    kind: "metric",
    name: `${t.metricName}${seenMetric.has(key) ? `_${t.id}` : ""}`,
    description: `${t.metricName}: ${t.description}`,
    definition: {
      metric: t.metricName,
      templateId: t.id,
      requiredTables: t.requiredTables,
      dimensions: t.params.map((p) => p.name),
      sqlPattern: t.sql(
        Object.fromEntries(t.params.map((p) => [p.name, p.values[0]]))
      ),
    },
  });
  seenMetric.add(key);
}

const GLOSSARY_ENTRIES: SemanticEntry[] = [
  {
    kind: "glossary",
    name: "churn",
    description:
      "A customer or subscription is 'churned' when a subscriptions row has status = 'canceled' and end_date set in the period in question. Churn is measured per subscription, not per customer.",
    definition: { rule: "subscriptions.status = 'canceled' AND subscriptions.end_date within period" },
  },
  {
    kind: "glossary",
    name: "active customer",
    description:
      "A customer is 'active' in a period if they hold at least one subscriptions row with start_date before the period end and end_date null or after the period end.",
    definition: { rule: "exists subscription with start_date < period_end AND (end_date is null OR end_date >= period_end)" },
  },
  {
    kind: "glossary",
    name: "MRR",
    description: "Monthly Recurring Revenue = sum(subscriptions.mrr) for subscriptions active at a point in time.",
    definition: { rule: "sum(mrr) where active" },
  },
  {
    kind: "glossary",
    name: "revenue vs transactions",
    description:
      "Realized revenue is derived from the transactions table (type='charge' minus type='refund'), NOT from subscriptions.mrr, which is a forward-looking recurring-revenue figure.",
    definition: { rule: "revenue = sum(transactions.amount) by type" },
  },
  {
    kind: "glossary",
    name: "customer PII",
    description: "customers.name and customers.email are personally identifiable information (PII) and are access-controlled separately from other customer attributes.",
    definition: { pii_columns: ["customers.name", "customers.email"] },
  },
];

export const SEMANTIC_ENTRIES: SemanticEntry[] = [...ENTITY_ENTRIES, ...METRIC_ENTRIES, ...GLOSSARY_ENTRIES];
