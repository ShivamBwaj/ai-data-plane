import {
  MONTHS,
  SEGMENTS,
  PLAN_TIERS,
  REGIONS,
  TICKET_CATEGORIES,
  PRODUCT_CATEGORIES,
  monthLabel,
} from "./domains";

export type ParamDomain = { name: string; values: readonly string[] };

export interface MetricTemplate {
  id: string;
  /** Canonical business metric name, as surfaced in metrics_used. */
  metricName: string;
  description: string;
  requiredTables: string[];
  params: ParamDomain[];
  /** Renders a natural-language question for a concrete param assignment. */
  question: (p: Record<string, string>) => string;
  /**
   * Ground-truth SQL. MUST return exactly one row with a single column
   * aliased `value` (numeric). Params come only from the closed domains
   * above, so straight interpolation is safe (never user input).
   */
  sql: (p: Record<string, string>) => string;
}

function monthBounds(month: string) {
  return { start: `date '${month}-01'`, end: `(date '${month}-01' + interval '1 month')` };
}

export const METRIC_TEMPLATES: MetricTemplate[] = [
  {
    id: "monthly_churn_rate",
    metricName: "monthly_churn_rate",
    description:
      "% of subscriptions active at the start of the month that were canceled (churned) during the month.",
    requiredTables: ["subscriptions"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `What was the monthly churn rate in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `with active_start as (
  select count(*)::numeric as n from subscriptions
  where start_date < ${start} and (end_date is null or end_date >= ${start})
),
canceled_in_month as (
  select count(*)::numeric as n from subscriptions
  where status = 'canceled' and end_date >= ${start} and end_date < ${end}
)
select case when active_start.n = 0 then 0 else round(100.0 * canceled_in_month.n / active_start.n, 2) end as value
from active_start, canceled_in_month`;
    },
  },
  {
    id: "churn_rate_by_plan",
    metricName: "monthly_churn_rate",
    description: "Monthly churn rate filtered to a single plan tier.",
    requiredTables: ["subscriptions"],
    params: [
      { name: "month", values: MONTHS },
      { name: "plan_tier", values: PLAN_TIERS },
    ],
    question: (p) => `What was the churn rate for the ${p.plan_tier} plan in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `with active_start as (
  select count(*)::numeric as n from subscriptions
  where plan_tier = '${p.plan_tier}' and start_date < ${start} and (end_date is null or end_date >= ${start})
),
canceled_in_month as (
  select count(*)::numeric as n from subscriptions
  where plan_tier = '${p.plan_tier}' and status = 'canceled' and end_date >= ${start} and end_date < ${end}
)
select case when active_start.n = 0 then 0 else round(100.0 * canceled_in_month.n / active_start.n, 2) end as value
from active_start, canceled_in_month`;
    },
  },
  {
    id: "churn_rate_by_region",
    metricName: "monthly_churn_rate",
    description: "Monthly churn rate filtered to customers in a single region.",
    requiredTables: ["subscriptions", "customers"],
    params: [
      { name: "month", values: MONTHS },
      { name: "region", values: REGIONS },
    ],
    question: (p) => `What was the churn rate in the ${p.region} region in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `with active_start as (
  select count(*)::numeric as n from subscriptions s join customers c on c.id = s.customer_id
  where c.region = '${p.region}' and s.start_date < ${start} and (s.end_date is null or s.end_date >= ${start})
),
canceled_in_month as (
  select count(*)::numeric as n from subscriptions s join customers c on c.id = s.customer_id
  where c.region = '${p.region}' and s.status = 'canceled' and s.end_date >= ${start} and s.end_date < ${end}
)
select case when active_start.n = 0 then 0 else round(100.0 * canceled_in_month.n / active_start.n, 2) end as value
from active_start, canceled_in_month`;
    },
  },
  {
    id: "mrr",
    metricName: "mrr",
    description: "Total monthly recurring revenue from subscriptions active at month end.",
    requiredTables: ["subscriptions"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `What was total MRR in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { end } = monthBounds(p.month);
      return `select coalesce(sum(mrr), 0) as value from subscriptions
where start_date < ${end} and (end_date is null or end_date >= ${end})`;
    },
  },
  {
    id: "new_mrr",
    metricName: "new_mrr",
    description: "MRR added from subscriptions that started during the month.",
    requiredTables: ["subscriptions"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `How much new MRR did we add in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `select coalesce(sum(mrr), 0) as value from subscriptions
where start_date >= ${start} and start_date < ${end}`;
    },
  },
  {
    id: "active_customers",
    metricName: "active_customers",
    description: "Distinct customers holding at least one active subscription at month end.",
    requiredTables: ["subscriptions"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `How many active customers did we have in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { end } = monthBounds(p.month);
      return `select count(distinct customer_id)::numeric as value from subscriptions
where start_date < ${end} and (end_date is null or end_date >= ${end})`;
    },
  },
  {
    id: "arpu",
    metricName: "arpu",
    description: "Average revenue per active customer (MRR / active customers).",
    requiredTables: ["subscriptions"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `What was ARPU in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { end } = monthBounds(p.month);
      return `with m as (
  select coalesce(sum(mrr), 0) as mrr from subscriptions
  where start_date < ${end} and (end_date is null or end_date >= ${end})
), c as (
  select count(distinct customer_id)::numeric as n from subscriptions
  where start_date < ${end} and (end_date is null or end_date >= ${end})
)
select case when c.n = 0 then 0 else round(m.mrr / c.n, 2) end as value from m, c`;
    },
  },
  {
    id: "new_customers",
    metricName: "new_customers",
    description: "Count of customers whose signup_date falls in the month.",
    requiredTables: ["customers"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `How many new customers signed up in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `select count(*)::numeric as value from customers
where signup_date >= ${start} and signup_date < ${end}`;
    },
  },
  {
    id: "ltv_by_segment",
    metricName: "customer_ltv",
    description: "Average lifetime net revenue (charges minus refunds) per customer in a segment.",
    requiredTables: ["customers", "transactions"],
    params: [{ name: "segment", values: SEGMENTS }],
    question: (p) => `What is the average lifetime value of a ${p.segment} customer?`,
    sql: (p) => `select round(avg(net), 2) as value from (
  select c.id, coalesce(sum(t.amount), 0) as net
  from customers c
  left join transactions t on t.customer_id = c.id
  where c.segment = '${p.segment}'
  group by c.id
) x`,
  },
  {
    id: "ticket_volume",
    metricName: "ticket_volume",
    description: "Count of support tickets created during the month.",
    requiredTables: ["support_tickets"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `How many support tickets were created in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `select count(*)::numeric as value from support_tickets
where created_at >= ${start} and created_at < ${end}`;
    },
  },
  {
    id: "ticket_volume_by_category",
    metricName: "ticket_volume",
    description: "Count of support tickets created during the month, in a single category.",
    requiredTables: ["support_tickets"],
    params: [
      { name: "month", values: MONTHS },
      { name: "category", values: TICKET_CATEGORIES },
    ],
    question: (p) => `How many ${p.category} support tickets were created in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `select count(*)::numeric as value from support_tickets
where category = '${p.category}' and created_at >= ${start} and created_at < ${end}`;
    },
  },
  {
    id: "avg_csat",
    metricName: "avg_csat",
    description: "Average customer satisfaction score (1-5) across tickets resolved during the month.",
    requiredTables: ["support_tickets"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `What was average CSAT in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `select round(avg(satisfaction_score), 2) as value from support_tickets
where resolved_at >= ${start} and resolved_at < ${end} and satisfaction_score is not null`;
    },
  },
  {
    id: "avg_resolution_days",
    metricName: "avg_resolution_time_days",
    description: "Average days between ticket creation and resolution, for tickets resolved during the month.",
    requiredTables: ["support_tickets"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `What was the average support ticket resolution time (in days) in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `select round(avg(resolved_at - created_at), 2) as value from support_tickets
where resolved_at >= ${start} and resolved_at < ${end}`;
    },
  },
  {
    id: "refund_rate",
    metricName: "refund_rate",
    description: "Refunded amount as a % of charged amount during the month.",
    requiredTables: ["transactions"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `What was the refund rate in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `with charges as (
  select coalesce(sum(amount), 0) as n from transactions
  where type = 'charge' and transaction_date >= ${start} and transaction_date < ${end}
), refunds as (
  select coalesce(sum(abs(amount)), 0) as n from transactions
  where type = 'refund' and transaction_date >= ${start} and transaction_date < ${end}
)
select case when charges.n = 0 then 0 else round(100.0 * refunds.n / charges.n, 2) end as value
from charges, refunds`;
    },
  },
  {
    id: "high_priority_ticket_share",
    metricName: "high_priority_ticket_share",
    description: "% of tickets created during the month with priority high or urgent.",
    requiredTables: ["support_tickets"],
    params: [{ name: "month", values: MONTHS }],
    question: (p) => `What share of support tickets created in ${monthLabel(p.month)} were high or urgent priority?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `with total as (
  select count(*)::numeric as n from support_tickets
  where created_at >= ${start} and created_at < ${end}
), hi as (
  select count(*)::numeric as n from support_tickets
  where created_at >= ${start} and created_at < ${end} and priority in ('high','urgent')
)
select case when total.n = 0 then 0 else round(100.0 * hi.n / total.n, 2) end as value
from total, hi`;
    },
  },
  {
    id: "revenue_by_product_category",
    metricName: "revenue_by_product_category",
    description: "Total charged revenue during the month for a product category (subscription vs addon).",
    requiredTables: ["transactions", "subscriptions", "products"],
    params: [
      { name: "month", values: MONTHS },
      { name: "category", values: PRODUCT_CATEGORIES },
    ],
    question: (p) => `How much ${p.category} revenue did we charge in ${monthLabel(p.month)}?`,
    sql: (p) => {
      const { start, end } = monthBounds(p.month);
      return `select coalesce(sum(t.amount), 0) as value
from transactions t
join subscriptions s on s.id = t.subscription_id
join products pr on pr.id = s.product_id
where t.type = 'charge' and pr.category = '${p.category}'
  and t.transaction_date >= ${start} and t.transaction_date < ${end}`;
    },
  },
];

export function templateById(id: string): MetricTemplate {
  const t = METRIC_TEMPLATES.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown metric template: ${id}`);
  return t;
}
