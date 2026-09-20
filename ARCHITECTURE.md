# Architecture

## Request flow

```
                          POST /api/ask { question, role, mode }
                                        |
                    +-------------------+-------------------+
                    |                                       |
              RAW PIPELINE                          SEMANTIC PIPELINE
        (raw-pipeline.ts)                      (semantic-pipeline.ts)
                    |                                       |
      full physical schema text                 retrieveRelevant(question)
      dumped into the prompt                    -> pgvector cosine search over
      (no business context,                        semantic_entries, scoped
      no role scoping)                             to the caller's Role
                    |                                       |
                    |                          role-scoped prompt: allowed
                    |                          tables/columns, mandatory row
                    |                          filters, retrieved entity/metric/
                    |                          glossary context
                    |                                       |
                    +-------------------+-------------------+
                                        |
                     generateObject({ model, schema })  <- structured output:
                                        |                    { sql, metrics_used,
                                        |                      source_tables, explanation }
                                        v
                              guardSql(sql, role)
                    parse AST (node-sql-parser) -> check every
                    table/column against the REAL schema and
                    the role's allow-list; check mandatory row
                    filters are present; reject non-SELECT
                                        |
                              (rejected)   (passed)
                                   |             |
                          refuse to answer   executeGuardedSql()
                                              run on app_readonly (SELECT-only
                                              Postgres role) + EXPLAIN ANALYZE
                                              for a real rows-scanned figure
                                        |
                                        v
                         { answer, sql, metrics_used, source_tables,
                           rows_scanned, latency_ms, tokens, ... }
```

Both pipelines return through the exact same `executeGuardedSql()` path and
the exact same `app_readonly` Postgres role. The raw pipeline just gets
`role = null`, so only the hard schema-hallucination check applies (no
column/row restrictions - matching what a role-less "chat with your DB" tool
actually does). This means the comparison is fair: neither pipeline gets a
weaker or stronger execution safety net than the other, only different
*planning* context.

## The three layers

**Semantic layer** (`src/lib/semantic/`)
- `metrics.ts` - 16 canonical business metrics (churn rate, MRR, ARPU, LTV,
  CSAT, refund rate, ...) as parameterized SQL templates. Each one is
  simultaneously (a) what the planner is shown as the "correct" way to
  compute that metric, and (b) the ground-truth generator for the benchmark.
- `knowledge.ts` - turns the physical schema (entities), the metric templates,
  and a hand-written glossary (what "churned" means, MRR vs. realized revenue,
  which columns are PII) into a flat list of `SemanticEntry` rows.
- `retrieval.ts` - embeds every entry (`text-embedding-3-small`) into a
  `vector(1536)` column with an ivfflat index, and does per-question
  cosine-similarity retrieval. **Entity entries are always included in full**
  rather than competing in the top-k ranking - see `DECISIONS.md` for why
  this mattered more than anything else.

**Permission layer** (`src/lib/permissions.ts`)
- Four roles (`admin`, `analyst`, `support_agent`, `regional_manager_na`), each
  declaring: which tables are visible, which columns are visible per table
  (omit a table here to allow all its columns), and optional mandatory row
  filters (e.g. `customers.region = 'NA'`).
- This is *data*, not prompt text - `sql-guard.ts` enforces it against the
  parsed query, independent of whether the model "remembered" the rule.

**Query planner** (`src/lib/pipelines/*.ts` + `src/lib/sql-guard.ts`)
- The planner is just a `generateObject` call constrained to a Zod schema
  (`{ sql, metrics_used, source_tables, explanation }`).
- The guard is the actual enforcement point: it parses the generated SQL with
  `node-sql-parser`, walks the AST to resolve every table/column reference
  (including unqualified ones, which the parser itself won't resolve for you),
  and rejects the query before it ever reaches Postgres if it references
  anything outside the physical schema or the role's allow-list.

## Data model

Synthetic SaaS dataset, seeded directly in Postgres: `customers`, `products`,
`subscriptions`, `transactions`, `support_tickets`. 3,000 customers, ~3,600
subscriptions, ~58,000 transactions, ~2,080 tickets, Feb 2023-Jul 2025, with
churn correlated to plan tier and support-ticket volume so metrics aren't
just noise.

Two extra tables carry the data plane's own state: `semantic_entries` (the
embedded semantic layer, read by `retrieval.ts`) and `benchmark_runs` (one row
per question per pipeline per benchmark run - what `/benchmark` reads).

## Security posture

- `app_readonly` (used to execute *all* model-generated SQL, from either
  pipeline): `SELECT`-only, on the five business tables, nothing else. Even if
  the guard had a bug, this Postgres role is the hard backstop against
  anything destructive.
- `app_writer` (used only by the app's own code - never to run model SQL):
  read/write on `semantic_entries`, `metric_templates`, `access_roles`,
  `benchmark_runs`.
- `statement_timeout` is set on both connections so a runaway query can't hang
  the process.
