"use client";

import { useEffect, useState } from "react";
import { ResultPanel, type PipelineResult } from "@/components/ResultPanel";

interface RoleInfo {
  id: string;
  label: string;
  description: string;
}

const EXAMPLE_QUESTIONS = [
  "What was the monthly churn rate in March 2024?",
  "What is the average lifetime value of an Enterprise customer?",
  "How many active customers did we have in June 2024?",
  "What share of tickets in January 2024 were high or urgent priority?",
  "What was total MRR in December 2023?",
  "What is Jane Smith's email address?",
];

export default function AskPage() {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [role, setRole] = useState("admin");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [semantic, setSemantic] = useState<PipelineResult | null>(null);
  const [raw, setRaw] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/roles")
      .then((r) => r.json())
      .then(setRoles)
      .catch(() => {});
  }, []);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSemantic(null);
    setRaw(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, mode: "both", role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setSemantic(data.semantic);
      setRaw(data.raw);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ask your data</h1>
        <p className="text-sm text-black/60 dark:text-white/60 max-w-3xl">
          Every question runs through two independent pipelines: a naive <strong>raw text-to-SQL</strong> baseline
          (the model sees only the physical schema) and the <strong>AI Data Plane</strong> (the model sees a
          role-scoped semantic layer — retrieved business concepts, metric definitions and a glossary — instead of
          raw tables). Both are guarded against schema hallucination and permission violations before anything
          executes.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What was the monthly churn rate in March 2024?"
            rows={2}
            className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <div className="flex sm:flex-col gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => ask(question)}
              disabled={loading}
              className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Running…" : "Compare pipelines"}
            </button>
          </div>
        </div>
        {roles.length > 0 && (
          <p className="text-xs text-black/40 dark:text-white/40">
            {roles.find((r) => r.id === role)?.description}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuestion(q);
                ask(q);
              }}
              className="text-xs px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
            >
              {q}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {(loading || semantic || raw) && (
        <section className="grid md:grid-cols-2 gap-4">
          <ResultPanel title="AI Data Plane" subtitle="semantic layer + permission layer + query planner" result={semantic} />
          <ResultPanel title="Raw text-to-SQL (baseline)" subtitle="full schema dumped into the prompt, no guardrails" result={raw} />
        </section>
      )}
    </div>
  );
}
