import { NextResponse } from "next/server";
import { sqlWriter } from "@/lib/db";

export async function GET() {
  const [latest] = await sqlWriter<{ run_id: string }[]>`
    select run_id from benchmark_runs order by created_at desc limit 1
  `;
  if (!latest) return NextResponse.json({ runId: null, pipelines: [], byMetric: [] });

  const runId = latest.run_id;

  const pipelines = await sqlWriter<
    {
      pipeline: string;
      n: number;
      sql_execution_success_rate: number;
      answer_correctness_rate: number;
      schema_hallucination_rate: number;
      permission_violation_rate: number;
      avg_rows_scanned: number;
      avg_latency_ms: number;
      avg_total_tokens: number;
    }[]
  >`
    select
      pipeline,
      count(*)::int as n,
      round(100.0 * count(*) filter (where sql_success) / count(*), 2) as sql_execution_success_rate,
      round(100.0 * count(*) filter (where correct) / count(*), 2) as answer_correctness_rate,
      round(100.0 * count(*) filter (where schema_hallucination) / count(*), 2) as schema_hallucination_rate,
      round(100.0 * count(*) filter (where permission_violation) / count(*), 2) as permission_violation_rate,
      round(avg(rows_scanned), 2) as avg_rows_scanned,
      round(avg(latency_ms), 2) as avg_latency_ms,
      round(avg(coalesce(prompt_tokens,0) + coalesce(completion_tokens,0)), 2) as avg_total_tokens
    from benchmark_runs
    where run_id = ${runId}
    group by pipeline
    order by pipeline
  `;

  const byMetric = await sqlWriter<
    { metric_name: string; pipeline: string; n: number; correct_rate: number; success_rate: number }[]
  >`
    select
      metric_name,
      pipeline,
      count(*)::int as n,
      round(100.0 * count(*) filter (where correct) / count(*), 2) as correct_rate,
      round(100.0 * count(*) filter (where sql_success) / count(*), 2) as success_rate
    from benchmark_runs
    where run_id = ${runId}
    group by metric_name, pipeline
    order by metric_name, pipeline
  `;

  return NextResponse.json({ runId, pipelines, byMetric });
}
