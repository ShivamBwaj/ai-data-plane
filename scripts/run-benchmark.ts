import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const CONCURRENCY = Number(process.argv[3] ?? 10);
const QUESTIONS_FILE = process.argv[2] ?? "benchmark/questions.json";

interface Question {
  id: string;
  templateId: string;
  metricName: string;
  params: Record<string, string>;
  question: string;
  expectedValue: number;
  requiredTables: string[];
}

function isCorrect(returned: number | null, expected: number): boolean {
  if (returned === null || Number.isNaN(returned)) return false;
  const diff = Math.abs(returned - expected);
  const tol = Math.max(0.01 * Math.abs(expected), 0.5);
  return diff <= tol;
}

async function pool<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  const { sqlWriter } = await import("../src/lib/db");
  const { runSemanticPipeline } = await import("../src/lib/pipelines/semantic-pipeline");
  const { runRawPipeline } = await import("../src/lib/pipelines/raw-pipeline");

  const questions: Question[] = JSON.parse(readFileSync(path.join(process.cwd(), QUESTIONS_FILE), "utf-8"));
  const runId = `run_${Date.now()}`;
  console.log(`Running benchmark ${runId} on ${questions.length} questions x 2 pipelines (concurrency ${CONCURRENCY})...`);

  type Row = {
    pipeline: "raw" | "semantic";
    question: Question;
    result: Awaited<ReturnType<typeof runRawPipeline>> | null;
    error: string | null;
  };

  const jobs: { pipeline: "raw" | "semantic"; question: Question }[] = [];
  for (const q of questions) {
    jobs.push({ pipeline: "raw", question: q });
    jobs.push({ pipeline: "semantic", question: q });
  }

  let done = 0;
  const rows = await pool<{ pipeline: "raw" | "semantic"; question: Question }, Row>(jobs, CONCURRENCY, async (job) => {
    try {
      const result =
        job.pipeline === "raw"
          ? await runRawPipeline(job.question.question)
          : await runSemanticPipeline(job.question.question, "admin");
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${jobs.length}`);
      return { pipeline: job.pipeline, question: job.question, result, error: null };
    } catch (e) {
      done++;
      return { pipeline: job.pipeline, question: job.question, result: null, error: (e as Error).message };
    }
  });

  console.log("Writing results to benchmark_runs...");
  for (const r of rows) {
    const correct = r.result ? isCorrect(r.result.returned_value, r.question.expectedValue) : false;
    await sqlWriter`
      insert into benchmark_runs (
        run_id, pipeline, question, metric_name, expected_value, generated_sql,
        sql_success, sql_error, schema_hallucination, permission_violation,
        returned_value, correct, rows_scanned, latency_ms, prompt_tokens, completion_tokens,
        metrics_used, source_tables
      ) values (
        ${runId}, ${r.pipeline}, ${r.question.question}, ${r.question.metricName}, ${r.question.expectedValue},
        ${r.result?.sql ?? null},
        ${r.result?.sql_success ?? false}, ${r.result?.sql_error ?? r.error},
        ${r.result?.schema_hallucination ?? false}, ${r.result?.permission_violation ?? false},
        ${r.result?.returned_value ?? null}, ${correct}, ${r.result?.rows_scanned ?? null},
        ${r.result?.latency_ms ?? null}, ${r.result?.prompt_tokens ?? null}, ${r.result?.completion_tokens ?? null},
        ${sqlWriter.json(r.result?.metrics_used ?? [])}, ${sqlWriter.json(r.result?.source_tables ?? [])}
      )
    `;
  }

  function summarize(pipeline: "raw" | "semantic") {
    const subset = rows.filter((r) => r.pipeline === pipeline);
    const n = subset.length;
    const sqlSuccess = subset.filter((r) => r.result?.sql_success).length;
    const hallucinated = subset.filter((r) => r.result?.schema_hallucination).length;
    const permViolation = subset.filter((r) => r.result?.permission_violation).length;
    const correct = subset.filter((r) => r.result && isCorrect(r.result.returned_value, r.question.expectedValue)).length;
    const avgRowsScanned = avg(subset.map((r) => r.result?.rows_scanned ?? 0));
    const avgLatency = avg(subset.map((r) => r.result?.latency_ms ?? 0));
    const avgTokens = avg(subset.map((r) => (r.result?.prompt_tokens ?? 0) + (r.result?.completion_tokens ?? 0)));
    return {
      n,
      sql_execution_success_rate: pct(sqlSuccess, n),
      answer_correctness_rate: pct(correct, n),
      schema_hallucination_rate: pct(hallucinated, n),
      permission_violation_rate: pct(permViolation, n),
      avg_rows_scanned: round(avgRowsScanned),
      avg_latency_ms: round(avgLatency),
      avg_total_tokens: round(avgTokens),
    };
  }

  const summary = { runId, raw: summarize("raw"), semantic: summarize("semantic") };
  writeFileSync(path.join(process.cwd(), "benchmark", "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  await sqlWriter.end();
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function pct(a: number, b: number) {
  return b === 0 ? 0 : round((100 * a) / b);
}
function round(n: number) {
  return Math.round(n * 100) / 100;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
