"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface PipelineSummary {
  pipeline: "raw" | "semantic";
  n: number;
  sql_execution_success_rate: number;
  answer_correctness_rate: number;
  schema_hallucination_rate: number;
  permission_violation_rate: number;
  avg_rows_scanned: number;
  avg_latency_ms: number;
  avg_total_tokens: number;
}

interface ByMetric {
  metric_name: string;
  pipeline: "raw" | "semantic";
  n: number;
  correct_rate: number;
  success_rate: number;
}

interface BenchmarkResponse {
  runId: string | null;
  pipelines: PipelineSummary[];
  byMetric: ByMetric[];
}

function StatCard({
  label,
  raw,
  semantic,
  suffix = "%",
  higherIsBetter = true,
}: {
  label: string;
  raw: number;
  semantic: number;
  suffix?: string;
  higherIsBetter?: boolean;
}) {
  const delta = semantic - raw;
  const better = higherIsBetter ? delta >= 0 : delta <= 0;
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 flex flex-col gap-2">
      <div className="text-xs text-black/50 dark:text-white/50">{label}</div>
      <div className="flex items-end gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {semantic}
            {suffix}
          </div>
          <div className="text-[11px] text-black/40 dark:text-white/40">AI Data Plane</div>
        </div>
        <div className="pb-1">
          <div className="text-sm tabular-nums text-black/40 dark:text-white/40">
            vs {raw}
            {suffix}
          </div>
          <div className="text-[11px] text-black/30 dark:text-white/30">raw baseline</div>
        </div>
      </div>
      {delta !== 0 && (
        <span
          className={`text-xs font-medium w-fit px-2 py-0.5 rounded-full ${
            better
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-red-500/10 text-red-700 dark:text-red-400"
          }`}
        >
          {delta > 0 ? "+" : ""}
          {Math.round(delta * 100) / 100}
          {suffix} {better ? "better" : "worse"}
        </span>
      )}
    </div>
  );
}

export default function BenchmarkPage() {
  const [data, setData] = useState<BenchmarkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/benchmark")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="p-8 text-red-600 text-sm">{error}</div>;
  if (!data) return <div className="p-8 text-sm text-black/40">Loading…</div>;
  if (!data.runId)
    return (
      <div className="p-8 text-sm text-black/50">
        No benchmark run yet. Run <code className="bg-black/5 dark:bg-white/10 px-1 rounded">npx tsx scripts/generate-questions.ts 500</code> then{" "}
        <code className="bg-black/5 dark:bg-white/10 px-1 rounded">npx tsx scripts/run-benchmark.ts</code>.
      </div>
    );

  const raw = data.pipelines.find((p) => p.pipeline === "raw");
  const semantic = data.pipelines.find((p) => p.pipeline === "semantic");
  if (!raw || !semantic) return <div className="p-8 text-sm text-black/50">Incomplete benchmark data.</div>;

  const chartData = [
    { metric: "SQL success", raw: raw.sql_execution_success_rate, semantic: semantic.sql_execution_success_rate },
    { metric: "Answer correct", raw: raw.answer_correctness_rate, semantic: semantic.answer_correctness_rate },
    { metric: "Schema hallucination", raw: raw.schema_hallucination_rate, semantic: semantic.schema_hallucination_rate },
    { metric: "Permission violation", raw: raw.permission_violation_rate, semantic: semantic.permission_violation_rate },
  ];

  const byMetricGrouped = Object.values(
    data.byMetric.reduce<Record<string, { metric_name: string; raw: number; semantic: number }>>((acc, r) => {
      acc[r.metric_name] ??= { metric_name: r.metric_name, raw: 0, semantic: 0 };
      acc[r.metric_name][r.pipeline] = r.correct_rate;
      return acc;
    }, {})
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col gap-8">
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Benchmark: raw text-to-SQL vs AI Data Plane</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          {raw.n} analytical questions per pipeline, generated from 16 parameterized metric templates with a
          programmatically computed ground-truth value for each (run <code className="font-mono">{data.runId}</code>).
        </p>
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="SQL execution success" raw={raw.sql_execution_success_rate} semantic={semantic.sql_execution_success_rate} />
        <StatCard label="Answer correctness" raw={raw.answer_correctness_rate} semantic={semantic.answer_correctness_rate} />
        <StatCard
          label="Schema hallucination"
          raw={raw.schema_hallucination_rate}
          semantic={semantic.schema_hallucination_rate}
          higherIsBetter={false}
        />
        <StatCard
          label="Permission violations"
          raw={raw.permission_violation_rate}
          semantic={semantic.permission_violation_rate}
          higherIsBetter={false}
        />
        <StatCard label="Avg rows scanned" raw={raw.avg_rows_scanned} semantic={semantic.avg_rows_scanned} suffix="" higherIsBetter={false} />
        <StatCard label="Avg latency" raw={raw.avg_latency_ms} semantic={semantic.avg_latency_ms} suffix=" ms" higherIsBetter={false} />
        <StatCard label="Avg tokens/query" raw={raw.avg_total_tokens} semantic={semantic.avg_total_tokens} suffix="" higherIsBetter={false} />
      </section>

      <section className="rounded-xl border border-black/10 dark:border-white/10 p-4">
        <h2 className="text-sm font-semibold mb-4">Quality metrics by pipeline (%)</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="raw" name="Raw baseline" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="semantic" name="AI Data Plane" fill="#4f46e5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl border border-black/10 dark:border-white/10 p-4">
        <h2 className="text-sm font-semibold mb-4">Answer correctness by metric type (%)</h2>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byMetricGrouped} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="metric_name" tick={{ fontSize: 11 }} width={160} />
              <Tooltip />
              <Legend />
              <Bar dataKey="raw" name="Raw baseline" fill="#94a3b8" radius={[0, 4, 4, 0]} />
              <Bar dataKey="semantic" name="AI Data Plane" fill="#4f46e5" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
