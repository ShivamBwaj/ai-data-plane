# Decisions

Why this is built the way it is, including the things that went wrong along
the way and what they taught.

## Ground-truth benchmark instead of an LLM judge

Comparing two LLM pipelines by having a third LLM grade the answers is
circular - the judge inherits its own blind spots, and "correctness" becomes
a vibe rather than a number. Instead, every benchmark question is generated
*from* a metric template whose SQL is known-correct by construction
(`src/lib/semantic/metrics.ts`), and the expected value is computed by
running that SQL directly against Postgres *before* either pipeline ever sees
the question (`scripts/generate-questions.ts`). "Correct" then just means:
does the pipeline's returned number match, within tolerance. This is more
work up front (16 metric templates instead of asking an LLM to invent 500
questions) but it's the only way "52.2% vs 37.0%" means anything.

## Why the guard operates on the parsed AST, not the prompt

The first version of the permission layer was going to be "tell the model
which columns it can't see." That's not enforcement, it's a suggestion - nothing
stops the model from ignoring it, and nothing *proves* it didn't. `sql-guard.ts`
instead parses whatever SQL the model actually produced and checks the real
table/column references against the role's allow-list. The distinction
matters concretely: in testing, asking for a customer's email under the
`analyst` role produces a query that correctly gets rejected (`Role "analyst"
does not have access to column "customers.email"`), while the same question
against the raw baseline - which has no permission layer at all - just answers
it. That's the whole pitch of a permission layer, demonstrated rather than
asserted.

## Three bugs, found by not trusting the first result

The initial full benchmark run showed the AI Data Plane doing *worse* than
the raw baseline on almost every axis - the opposite of the thesis. Two ways
to react to that: report it, or assume something's wrong and check. Three
real bugs came out of checking:

**1. CTE output columns flagged as hallucinated.** `node-sql-parser` has no
concept of `WITH` scoping - given `WITH x AS (SELECT count(*) AS value ...)
SELECT value FROM x`, it reports `value` as a column reference with an
unresolvable table, indistinguishable from a genuinely hallucinated column.
Since the planner is explicitly told to alias its answer as `value`, this was
flagging ~10% of otherwise-correct semantic-pipeline queries as hallucinating.
Fixed by collecting each CTE's own output aliases and excluding them from the
hallucination check (`cteOutputColumns` in `sql-guard.ts`).

**2. `SELECT *` silently bypassed column-level permissions.** Same root
cause, different symptom: a star column comes back from the parser as the
literal string `"(.*)"`, which doesn't match any real column name - so it was
neither being checked for hallucination nor for permission violations. That
second part is a real security gap, not just a benchmark artifact: a
column-restricted role could `SELECT *` and get everything, including columns
it's supposed to be denied. Fixed by explicitly detecting the star marker and
denying it outright against any column-restricted table.

**3. The actual driver of high hallucination: retrieval starving the model of
schema grounding.** After fixing (1) and (2), the semantic pipeline's
hallucination rate barely moved (57% -> 31.6%) while raw stayed under 3%.
That gap was too large to be residual parser noise. The cause: `retrieveRelevant()`
did a single top-k cut across all ~26 semantic-layer entries (5 entities, 16
metrics, 5 glossary terms). A question's embedding lands much closer to a
specific metric's description than to a table's entity definition - so the
entity entry carrying that table's *actual column names* would often get
crowded out of the top 10 by metric entries. The model would know "use
`support_tickets`" from the metric context, but not that the category column
is literally named `category` (it guessed `ticket_type`). The fix: entity
entries are now always included in full (the corpus is tiny - 5 entities,
essentially free) and vector search only narrows the metric/glossary entries.
Hallucination dropped to 2% - tied with raw - immediately, and correctness
jumped from ~37% to 52.2% in the same run. Verified on 6 hand-picked questions
covering different metric types *before* spending another full run confirming
it.

The lesson that generalizes: a semantic layer's entire value proposition is
grounding the model in real schema. A retrieval strategy that can silently
drop that grounding for a given question defeats the purpose - and it will
look like a "hallucination problem" in the numbers, not a "retrieval problem,"
unless you go looking.

## Model choice: cost-driven, not a fixed decision

Started on `openai/gpt-4o-mini`. Switched to `z-ai/glm-5.3-flash` to cut cost
further, discovered it forces mandatory reasoning tokens (500-1300 tokens of
internal reasoning per call, non-optional), which largely offset the
per-token savings and roughly doubled latency - reverted. Landed on
`deepseek/deepseek-v4-flash`: cheapest of the three per token, no forced
reasoning tax, no accuracy regression observed. The whole 500-question x
2-pipeline x however-many-re-runs benchmarking effort cost under $0.40 total.

Also worth knowing for next time: OpenRouter pre-authorizes a request against
`max_tokens * price`, defaulting `max_tokens` to the model's full context
window (131K+ tokens) when it's not set explicitly. On a low-balance key, that
alone caused 402 errors that looked like a real credit shortage but weren't -
capping `maxOutputTokens` explicitly fixed it. Separately, a genuinely-expired
free-tier key produced an *identical-looking* error, and a stale
`OPENROUTER_API_KEY` already set in the shell environment silently shadowed
`.env.local` on top of that - three different failure modes that all
presented as "insufficient credits," each needing to be isolated (raw `curl`
requests, then a logging `fetch` wrapper around the AI SDK call to see the
literal `Authorization` header) before the real one could be fixed.
