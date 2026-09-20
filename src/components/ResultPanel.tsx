"use client";

import { useState } from "react";

export interface PipelineResult {
  pipeline: "raw" | "semantic";
  answer: string;
  sql: string | null;
  metrics_used: string[];
  source_tables: string[];
  rows_scanned: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  sql_success: boolean;
  sql_error: string | null;
  schema_hallucination: boolean;
  permission_violation: boolean;
  returned_value: number | null;
  rows: Record<string, unknown>[];
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
        ok
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
          : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
      }`}
    >
      {label}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 font-mono">
      {children}
    </span>
  );
}

export function ResultPanel({ title, subtitle, result }: { title: string; subtitle: string; result: PipelineResult | null }) {
  const [showSql, setShowSql] = useState(true);
  const [showRows, setShowRows] = useState(false);

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03]">
        <div className="font-semibold">{title}</div>
        <div className="text-xs text-black/50 dark:text-white/50">{subtitle}</div>
      </div>

      {!result ? (
        <div className="p-6 text-sm text-black/40 dark:text-white/40 animate-pulse">Thinking…</div>
      ) : (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge ok={result.sql_success} label={result.sql_success ? "SQL executed" : "SQL failed"} />
            <Badge ok={!result.schema_hallucination} label={result.schema_hallucination ? "schema hallucination" : "schema valid"} />
            <Badge ok={!result.permission_violation} label={result.permission_violation ? "permission violation" : "permission ok"} />
          </div>

          <p className="text-sm leading-relaxed">{result.answer}</p>

          {result.returned_value !== null && (
            <div className="text-2xl font-semibold tabular-nums">
              {result.returned_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-black/60 dark:text-white/60">
            <span>{result.latency_ms} ms</span>
            <span>{result.prompt_tokens + result.completion_tokens} tokens</span>
            <span>{result.rows_scanned} rows scanned</span>
          </div>

          {result.metrics_used.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-black/40 dark:text-white/40 self-center">metrics_used:</span>
              {result.metrics_used.map((m) => (
                <Chip key={m}>{m}</Chip>
              ))}
            </div>
          )}
          {result.source_tables.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-black/40 dark:text-white/40 self-center">source_tables:</span>
              {result.source_tables.map((m) => (
                <Chip key={m}>{m}</Chip>
              ))}
            </div>
          )}

          {result.sql && (
            <div>
              <button
                onClick={() => setShowSql((s) => !s)}
                className="text-xs font-medium text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
              >
                {showSql ? "hide" : "show"} generated SQL
              </button>
              {showSql && (
                <pre className="mt-1.5 text-xs bg-black/5 dark:bg-white/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                  {result.sql}
                </pre>
              )}
            </div>
          )}

          {result.sql_error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-500/5 rounded-lg p-2 border border-red-500/20">
              {result.sql_error}
            </div>
          )}

          {result.rows.length > 0 && (
            <div>
              <button
                onClick={() => setShowRows((s) => !s)}
                className="text-xs font-medium text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
              >
                {showRows ? "hide" : "show"} raw rows ({result.rows.length})
              </button>
              {showRows && (
                <pre className="mt-1.5 text-xs bg-black/5 dark:bg-white/5 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto">
                  {JSON.stringify(result.rows.slice(0, 20), null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
