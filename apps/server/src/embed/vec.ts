// sqlite-vec storage layer. The extension itself is loaded once per
// connection in db/client.ts (`sqliteVec.load(sqlite)`); everything here is
// plain SQL through drizzle's sql`` runner.
//
// `vec_chunks` is a vec0 virtual table created LAZILY (not by a drizzle
// migration) because its dimension depends on the configured embedding
// model: it is created with the observed dimension of the first embedding
// batch, and (model, dimension) are recorded in the embed_meta table.
// Changing the embedding model changes dimensions → the whole vector space
// must be rebuilt (resetAllEmbeddings), then sources reindexed.
//
// vec0 rows carry the embedding plus auxiliary chunk_id/source_id columns
// (this sqlite-vec version forbids auxiliary-column filters in MATCH
// queries, so retrieval joins back to the chunks table — see retrieve.ts).
// vec0 has no foreign keys: chunk/video/source deletion must delete the
// matching vec rows explicitly (helpers below).

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { embedMeta, videos } from '../db/schema.js';

const VEC_TABLE = 'vec_chunks';

export class VecDimensionMismatchError extends Error {
  constructor(
    public readonly existing: number,
    public readonly requested: number,
  ) {
    super(
      `embedding dimension mismatch: ${VEC_TABLE} holds ${existing}d vectors but the current model produced ${requested}d; reindex sources to rebuild embeddings`,
    );
    this.name = 'VecDimensionMismatchError';
  }
}

export interface EmbedState {
  model: string;
  dimension: number;
}

export function vecTableExists(db: Db): boolean {
  const row = db.get<{ n: number }>(
    sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${VEC_TABLE}`,
  );
  return (row?.n ?? 0) > 0;
}

/** Declared embedding dimension of the existing vec table, null when absent. */
export function vecChunksDimension(db: Db): number | null {
  if (!vecTableExists(db)) return null;
  const row = db.get<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${VEC_TABLE}`,
  );
  const dimension = row?.sql.match(/float\[(\d+)\]/i)?.[1];
  return dimension ? Number.parseInt(dimension, 10) : null;
}

/** Create vec_chunks with the given dimension; throw if it exists with another. */
export function ensureVecChunksTable(db: Db, dimension: number): void {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error(`invalid embedding dimension: ${dimension}`);
  }
  const existing = vecChunksDimension(db);
  if (existing !== null) {
    if (existing !== dimension) throw new VecDimensionMismatchError(existing, dimension);
    return;
  }
  db.run(
    sql.raw(
      `CREATE VIRTUAL TABLE ${VEC_TABLE} USING vec0(` +
        `embedding float[${dimension}], +chunk_id TEXT, +source_id TEXT)`,
    ),
  );
}

/** The recorded vector-store state; null when nothing has been embedded. */
export function getEmbedState(db: Db): EmbedState | null {
  const rows = db.select().from(embedMeta).all();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const model = map.get('model');
  const dimension = Number.parseInt(map.get('dimension') ?? '', 10);
  if (!model || !Number.isInteger(dimension) || dimension <= 0) return null;
  if (!vecTableExists(db)) {
    // Stale meta without its table (e.g. manual DB surgery): self-heal.
    db.delete(embedMeta).run();
    return null;
  }
  return { model, dimension };
}

/** Record the state after (re)creating the vec table. Overwrites. */
export function setEmbedState(db: Db, state: EmbedState): void {
  for (const [key, value] of [
    ['model', state.model],
    ['dimension', String(state.dimension)],
  ] as const) {
    db.insert(embedMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: embedMeta.key, set: { value } })
      .run();
  }
}

export interface ChunkVectorRow {
  chunkId: string;
  sourceId: string;
  embedding: number[];
}

/** Insert one vec row per chunk. Vectors are bound as JSON (sqlite-vec decodes). */
export function insertChunkVectors(db: Db, rows: ChunkVectorRow[]): void {
  for (const row of rows) {
    db.run(
      sql`INSERT INTO vec_chunks (embedding, chunk_id, source_id)
          VALUES (${JSON.stringify(row.embedding)}, ${row.chunkId}, ${row.sourceId})`,
    );
  }
}

/** Delete vec rows for one video. No-op when the vec table does not exist. */
export function deleteVecRowsForVideo(db: Db, videoId: string): void {
  if (!vecTableExists(db)) return;
  db.run(
    sql`DELETE FROM vec_chunks WHERE chunk_id IN
        (SELECT id FROM chunks WHERE video_id = ${videoId})`,
  );
}

/** Delete vec rows for one source. No-op when the vec table does not exist. */
export function deleteVecRowsForSource(db: Db, sourceId: string): void {
  if (!vecTableExists(db)) return;
  db.run(sql`DELETE FROM vec_chunks WHERE source_id = ${sourceId}`);
}

/**
 * Full reset of the vector space (embedding-model change): drop the vec
 * table, delete every chunk + meta row, and mark previously-embedded videos
 * back to 'fetched' so their status stays truthful. Per-source reindex jobs
 * rebuild embeddings from there.
 */
export function resetAllEmbeddings(db: Db): void {
  db.transaction((tx) => {
    tx.run(sql`DROP TABLE IF EXISTS vec_chunks`);
    tx.delete(embedMeta).run();
    tx.run(sql`DELETE FROM chunks`);
    tx.update(videos)
      .set({ embeddedAt: null, status: 'fetched' })
      .where(eq(videos.status, 'embedded'))
      .run();
  });
}
