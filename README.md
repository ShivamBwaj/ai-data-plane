# AI Data Plane

An AI Data Plane sits between an LLM and a raw database: instead of dumping tables
into a prompt and hoping the model infers relationships and business definitions
correctly, the model queries through a **semantic layer** (business concepts,
metric definitions, glossary), a **permission layer** (role-scoped table/column/row
access, hard-enforced against the SQL's parsed AST — not just prompted), and a
**query planner** that turns a natural-language question into governed SQL.

```
             AI AGENT
                 |
           DATA PLANE
     +-----------+------------+
     |           |            |
 semantic     permission    query
  layer         layer       planner
     |           |            |
     +-----------+------------+
                 |
            Postgres (Supabase)
```

Every answer returns its receipt:

```json
{
  "answer": "Monthly churn rate in March 2024 was 3.1%...",
  "sql": "with active_start as (...) select ... as value ...",
  "metrics_used": ["monthly_churn_rate"],
  "source_tables": ["subscriptions"]
}
```

This repo ships **two** pipelines side by side so the difference is measurable, not
just asserted:

- **Raw baseline** (`src/lib/pipelines/raw-pipeline.ts`) - the model sees the full
  physical schema and nothing else. This is what most "chat with your database"
  tools do today.
- **AI Data Plane** (`src/lib/pipelines/semantic-pipeline.ts`) - the model sees
  only the semantic-layer entries retrieved (via pgvector cosine similarity) as
  relevant to the question, scoped to the caller's role. Generated SQL from
  *both* pipelines is independently parsed and validated (`src/lib/sql-guard.ts`)
  against the real schema and the role's allow-list before it's ever executed,
  using a hard read-only Postgres role (`app_readonly`) as a final backstop.

## Why this design

- **Metric definitions live in code, not in the model's head.** `src/lib/semantic/metrics.ts`
  defines 16 canonical business metrics (churn rate, MRR, ARPU, LTV, CSAT, refund
  rate, ...) as parameterized SQL templates. These are simultaneously (a) the
  semantic layer's source of truth surfaced to the planner, and (b) the
  ground-truth generator for the benchmark - so "correct" has an objective,
  numeric definition instead of relying on an LLM judge.
- **Permissions are enforced on the SQL, not on the prompt.** A role can be told
  "don't show PII" in its instructions, but the guard rejects the *query* if it
  references `customers.email` under the `analyst` role, regardless of what the
  model tried to do (`src/lib/sql-guard.ts`, node-sql-parser AST walk over
  `tableList`/`columnList`, including unqualified-column resolution which the
  parser itself doesn't do for you).
- **Retrieval is real pgvector RAG**, not a hand-rolled keyword match: metric/entity/
  glossary descriptions are embedded (`openai/text-embedding-3-small` via
  OpenRouter) and stored in a `vector(1536)` column with an ivfflat index; each
  question does a cosine-similarity top-k lookup.
- **"Rows scanned" is measured, not guessed:** each execution runs
  `EXPLAIN (ANALYZE, FORMAT JSON)` and sums `Actual Rows * Actual Loops` across
  the plan tree - a real cost signal, not a proxy for "rows returned".

## Try it

```bash
npm install
npm run dev
```

Ask a question, pick a role, and compare both pipelines side by side at `/`. Try
switching to **Analyst (PII masked)** and asking "What is Jane Smith's email
address?" - the AI Data Plane refuses (permission violation, caught before
execution); the raw baseline, which has no concept of roles, answers it.

See the 500-question benchmark at `/benchmark`.

## Benchmark methodology

`scripts/generate-questions.ts` instantiates the 16 metric templates across their
parameter domains (32 months x plan tiers / regions / ticket categories / product
categories / segments), samples up to 500 distinct (template, params) pairs, and
computes each one's **ground-truth expected value** by running its canonical SQL
directly against Postgres.

`scripts/run-benchmark.ts` then runs all 500 questions through *both* pipelines
(1,000 LLM calls total, `deepseek/deepseek-v4-flash` via OpenRouter, concurrency
8), executes whatever SQL each one produces through the same guarded, read-only
connection, and logs per-question results to `benchmark_runs`. A pipeline's
answer is scored `correct` if its returned numeric value is within 1%
(or ±0.5 absolute, whichever is larger) of the ground truth - an objective
check, no LLM-as-judge involved.

### Results (run `run_1789895411962`)

| Metric | Raw baseline | AI Data Plane | Delta |
|---|---|---|---|
| Answer correctness | 37.0% | **52.2%** | **+15.2pp (+41% relative)** |
| SQL execution success | 83.0% | 85.8% | +2.8pp |
| Schema hallucination | 2.0% | 2.0% | tied |
| Permission violation | 0.4% | 0.6% | both run as `admin` - see below |
| Avg rows scanned | 1.25 | 0.86 | -31% |
| Avg latency | 7,786 ms | 10,560 ms | +36% (context/retrieval overhead) |
| Avg tokens/query | 619 | 1,203 | +94% (context/retrieval overhead) |

The benchmark runs the semantic pipeline as `admin` (no column/row restrictions)
so the *raw SQL quality* comparison isn't confounded by permission scoping -
permission enforcement is instead demonstrated interactively (see above, or
`scripts/`-free: open `/`, pick a non-admin role, ask for PII).

Reproducing this took three real bug fixes along the way, each found by
distrusting a suspicious result instead of reporting it - see `DECISIONS.md`
for the full story (a CTE-output-column false positive, a `SELECT *`
permission bypass, and a retrieval-grounding gap that was the actual root
cause of most hallucination).

Metrics captured per question per pipeline:

| Metric | What it measures |
|---|---|
| SQL execution success | Did the generated SQL parse, pass guardrails, and run without a DB error? |
| Answer correctness | Does the returned value match the programmatically computed ground truth? |
| Schema hallucination | Did the SQL reference a table/column that doesn't exist? |
| Permission violation | Did the SQL violate the caller's role policy? (benchmark runs the semantic pipeline as `admin`, so this axis is demonstrated interactively instead - see above) |
| Rows scanned | `EXPLAIN ANALYZE`-derived actual rows touched across the query plan |
| Latency | Wall-clock ms for planning + execution |
| Tokens | Prompt + completion tokens for the planning call |

Re-run it yourself:

```bash
npx tsx scripts/seed-semantic-layer.ts       # embed + store the semantic layer (once, or after editing metrics.ts)
npx tsx scripts/generate-questions.ts 500    # writes benchmark/questions.json
npx tsx scripts/run-benchmark.ts             # writes to benchmark_runs, prints benchmark/summary.json
```

## Data

A synthetic but internally-consistent SaaS dataset, seeded directly in Postgres:
3,000 customers, ~3,600 subscriptions, ~58,000 transactions, ~2,080 support
tickets, spanning Feb 2023 - Jul 2025, with churn correlated to plan tier and
support-ticket volume so the metrics aren't just noise.

## Stack

Next.js 16 (App Router) · TypeScript · Supabase Postgres (+ pgvector) ·
AI SDK v6 · OpenRouter (`deepseek/deepseek-v4-flash` for planning,
`text-embedding-3-small` for retrieval) · `node-sql-parser` for AST-level SQL
validation · Recharts

See `ARCHITECTURE.md` for how the pieces fit together and `DECISIONS.md` for
why they're built this way (including the bugs found while building this).

## Setup

Copy `.env.local` and fill in:

```
AI_DATA_PLANE_OPENROUTER_API_KEY=   # OpenRouter key (named to avoid colliding with any
                                     # OPENROUTER_API_KEY already in your shell env - dotenv
                                     # and Next.js's env loader never override an existing var)
DATABASE_URL=                       # Postgres conn string, app_readonly role (SELECT-only)
DATABASE_WRITER_URL=                # Postgres conn string, app_writer role (semantic layer + benchmark logs)
```

The two DB roles and the schema/seed data are provisioned via the migrations in
this repo's Supabase project history (`app_readonly`: SELECT on the five
business tables only; `app_writer`: read/write on `semantic_entries`,
`metric_templates`, `access_roles`, `benchmark_runs`).

## Project layout

```
src/lib/schema.ts              physical DB schema (ground truth for hallucination checks)
src/lib/permissions.ts         role -> table/column/row access policy
src/lib/sql-guard.ts           parses + validates generated SQL against schema + role
src/lib/semantic/metrics.ts    16 canonical metric templates (semantic layer + ground truth)
src/lib/semantic/knowledge.ts  entities/metrics/glossary -> semantic_entries rows
src/lib/semantic/retrieval.ts  embeds + pgvector top-k retrieval
src/lib/pipelines/raw-pipeline.ts        baseline: LLM -> raw SQL
src/lib/pipelines/semantic-pipeline.ts   AI Data Plane: LLM -> semantic-scoped SQL
scripts/                       seed, question generation, benchmark runner
src/app/                       Ask UI (/) and Benchmark dashboard (/benchmark)
```
