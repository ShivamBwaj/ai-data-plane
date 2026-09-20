import { embed, embedMany } from "ai";
import { sqlWriter } from "../db";
import { embeddingModel } from "../llm";
import { SEMANTIC_ENTRIES, type SemanticEntry } from "./knowledge";

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Embeds every semantic entry and (re)writes the semantic_entries table. Run once via scripts/seed-semantic-layer.ts. */
export async function seedSemanticLayer(): Promise<number> {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: SEMANTIC_ENTRIES.map((e) => e.description),
  });

  await sqlWriter`delete from semantic_entries`;
  for (let i = 0; i < SEMANTIC_ENTRIES.length; i++) {
    const e = SEMANTIC_ENTRIES[i];
    await sqlWriter`
      insert into semantic_entries (kind, name, description, definition, embedding)
      values (${e.kind}, ${e.name}, ${e.description}, ${sqlWriter.json(JSON.parse(JSON.stringify(e.definition)))}, ${toVectorLiteral(embeddings[i])}::vector)
    `;
  }
  return SEMANTIC_ENTRIES.length;
}

export interface RetrievedEntry {
  kind: SemanticKindDb;
  name: string;
  description: string;
  definition: Record<string, unknown>;
  similarity: number;
}
type SemanticKindDb = SemanticEntry["kind"];

/**
 * Vector-similarity retrieval of the top-k most relevant semantic layer
 * entries for a question (RAG).
 *
 * Entity entries are always included in full rather than left to compete in
 * the similarity ranking. The corpus is small (5 entities vs. ~16 metrics +
 * 5 glossary terms), and a question's embedding tends to land much closer to
 * a specific metric description than to a table's entity definition - so
 * with a single top-k cut, the entity entry carrying a table's *actual
 * column names* would often get crowded out by metric entries, leaving the
 * planner to guess column names from the metric description alone. Since
 * entity entries are the only place physical column names live, dropping
 * them is exactly what causes schema hallucination - so they're pinned.
 */
export async function retrieveRelevant(question: string, k = 8): Promise<RetrievedEntry[]> {
  const { embedding } = await embed({ model: embeddingModel, value: question });
  const vec = toVectorLiteral(embedding);

  const entities = await sqlWriter<
    { kind: SemanticKindDb; name: string; description: string; definition: Record<string, unknown>; similarity: number }[]
  >`
    select kind, name, description, definition, 1 - (embedding <=> ${vec}::vector) as similarity
    from semantic_entries
    where kind = 'entity'
    order by embedding <=> ${vec}::vector
  `;

  const rest = await sqlWriter<
    { kind: SemanticKindDb; name: string; description: string; definition: Record<string, unknown>; similarity: number }[]
  >`
    select kind, name, description, definition, 1 - (embedding <=> ${vec}::vector) as similarity
    from semantic_entries
    where kind != 'entity'
    order by embedding <=> ${vec}::vector
    limit ${k}
  `;

  return [...entities, ...rest];
}
