// Retrieval: embed the query, then top-k cosine over the chunks of the
// bot's attached sources only (chunks → bot_sources). sqlite-vec is
// brute-force by design, so this is a full scan with vec_distance_cosine
// joined back to the chunks table for citation metadata (this sqlite-vec
// version rejects auxiliary-column filters inside MATCH queries — the join
// form is the supported one, and correct post-filtering).

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { botSources } from '../db/schema.js';
import type { Embedder } from './embedder.js';
import { getEmbedState, vecTableExists } from './vec.js';

export const DEFAULT_TOP_K = 8;

export interface RetrievedChunk {
  videoId: string;
  sourceId: string;
  title: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Cosine distance (0 = identical). Lower is more similar. */
  distance: number;
}

export interface RetrieveDeps {
  db: Db;
  embedder: Embedder;
}

interface VecRow {
  video_id: string;
  source_id: string;
  title: string;
  start_ms: number;
  end_ms: number;
  text: string;
  distance: number;
}

/**
 * Top-k chunks (ascending cosine distance) for a bot. The query is embedded
 * with the model the vector space was built with (recorded in embed_meta),
 * so retrieval stays consistent until a reindex catches up with a model
 * change. Returns [] when the bot has no sources or nothing is embedded.
 */
export async function retrieveForBot(
  deps: RetrieveDeps,
  input: { botId: string; query: string; k?: number },
): Promise<RetrievedChunk[]> {
  const { db, embedder } = deps;
  const k = input.k ?? DEFAULT_TOP_K;

  const state = getEmbedState(db);
  if (!state || !vecTableExists(db)) return [];

  const sourceIds = db
    .select({ sourceId: botSources.sourceId })
    .from(botSources)
    .where(eq(botSources.botId, input.botId))
    .all()
    .map((r) => r.sourceId);
  if (sourceIds.length === 0) return [];

  const [queryEmbedding] = await embedder.embed(state.model, [input.query]);
  if (!queryEmbedding) return [];

  const rows = db.all<VecRow>(sql`
    SELECT c.video_id, c.source_id, c.title, c.start_ms, c.end_ms, c.text,
           vec_distance_cosine(v.embedding, ${JSON.stringify(queryEmbedding)}) AS distance
    FROM vec_chunks v
    JOIN chunks c ON c.id = v.chunk_id
    WHERE c.source_id IN (${sql.join(
      sourceIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    ORDER BY distance ASC
    LIMIT ${k}
  `);

  return rows.map((row) => ({
    videoId: row.video_id,
    sourceId: row.source_id,
    title: row.title,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    distance: row.distance,
  }));
}
