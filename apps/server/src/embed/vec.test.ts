// sqlite-vec round trip on the real extension (loaded by db/client.ts):
// create → insert → query → delete, dimension bookkeeping, and the
// model-change full reset.

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunks, videos } from '../db/schema.js';
import { type TestDb, makeTestDb, seedSource } from '../testing/test-db.js';
import {
  VecDimensionMismatchError,
  deleteVecRowsForSource,
  deleteVecRowsForVideo,
  ensureVecChunksTable,
  getEmbedState,
  insertChunkVectors,
  resetAllEmbeddings,
  setEmbedState,
  vecChunksDimension,
  vecTableExists,
} from './vec.js';

function seedVideo(t: TestDb, videoId: string, sourceId: string): void {
  t.db
    .insert(videos)
    .values({
      id: videoId,
      sourceId,
      title: `Title ${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: null,
      durationS: 60,
      language: 'en',
      status: 'fetched',
      fetchedAt: new Date().toISOString(),
    })
    .run();
}

function insertChunk(t: TestDb, chunkId: string, videoId: string, sourceId: string): void {
  t.db
    .insert(chunks)
    .values({ id: chunkId, videoId, sourceId, title: 'T', startMs: 0, endMs: 1000, text: 'hi' })
    .run();
}

function vecRowCount(db: TestDb['db']): number {
  return db.get<{ n: number }>(sql`SELECT count(*) AS n FROM vec_chunks`)?.n ?? 0;
}

describe('vec store', () => {
  let t: TestDb;
  let sourceId: string;

  beforeEach(() => {
    t = makeTestDb();
    sourceId = seedSource(t.db);
  });

  afterEach(() => {
    t.cleanup();
  });

  it('round trip: create table, insert vectors, KNN-query them back', () => {
    expect(vecTableExists(t.db)).toBe(false);
    expect(vecChunksDimension(t.db)).toBeNull();

    ensureVecChunksTable(t.db, 4);
    expect(vecTableExists(t.db)).toBe(true);
    expect(vecChunksDimension(t.db)).toBe(4);

    insertChunkVectors(t.db, [
      { chunkId: 'c1', sourceId, embedding: [1, 0, 0, 0] },
      { chunkId: 'c2', sourceId, embedding: [0, 1, 0, 0] },
    ]);
    expect(vecRowCount(t.db)).toBe(2);

    const rows = t.db.all<{ chunk_id: string; distance: number }>(
      sql`SELECT chunk_id, distance FROM vec_chunks
          WHERE embedding MATCH ${JSON.stringify([1, 0, 0, 0])} AND k = 2
          ORDER BY distance`,
    );
    expect(rows[0]?.chunk_id).toBe('c1');
    expect(rows[0]?.distance).toBeCloseTo(0);
    expect(rows[1]?.chunk_id).toBe('c2');
    expect(rows[1]?.distance).toBeGreaterThan(0);
  });

  it('ensureVecChunksTable is idempotent and rejects a different dimension', () => {
    ensureVecChunksTable(t.db, 4);
    expect(() => ensureVecChunksTable(t.db, 4)).not.toThrow();
    expect(() => ensureVecChunksTable(t.db, 8)).toThrow(VecDimensionMismatchError);
    try {
      ensureVecChunksTable(t.db, 8);
    } catch (err) {
      expect((err as VecDimensionMismatchError).existing).toBe(4);
      expect((err as VecDimensionMismatchError).requested).toBe(8);
    }
  });

  it('embed state: absent at first, recorded with model + dimension, self-heals stale meta', () => {
    expect(getEmbedState(t.db)).toBeNull();
    ensureVecChunksTable(t.db, 4);
    setEmbedState(t.db, { model: 'test/embed-model', dimension: 4 });
    expect(getEmbedState(t.db)).toEqual({ model: 'test/embed-model', dimension: 4 });

    t.db.run(sql`DROP TABLE vec_chunks`);
    expect(getEmbedState(t.db)).toBeNull(); // meta without its table is dropped
  });

  it('deleteVecRowsForVideo / deleteVecRowsForSource remove only matching rows', () => {
    const other = seedSource(t.db, { id: 'source-other' });
    seedVideo(t, 'vid-a', sourceId);
    seedVideo(t, 'vid-b', other);
    insertChunk(t, 'c1', 'vid-a', sourceId);
    insertChunk(t, 'c2', 'vid-a', sourceId);
    insertChunk(t, 'c3', 'vid-b', other);
    ensureVecChunksTable(t.db, 4);
    insertChunkVectors(t.db, [
      { chunkId: 'c1', sourceId, embedding: [1, 0, 0, 0] },
      { chunkId: 'c2', sourceId, embedding: [0, 1, 0, 0] },
      { chunkId: 'c3', sourceId: other, embedding: [0, 0, 1, 0] },
    ]);

    deleteVecRowsForVideo(t.db, 'vid-a');
    expect(vecRowCount(t.db)).toBe(1);

    deleteVecRowsForSource(t.db, other);
    expect(vecRowCount(t.db)).toBe(0);
  });

  it('vec deletes are a no-op when the vec table does not exist', () => {
    expect(() => deleteVecRowsForVideo(t.db, 'vid-missing')).not.toThrow();
    expect(() => deleteVecRowsForSource(t.db, sourceId)).not.toThrow();
  });

  it('resetAllEmbeddings drops vectors, chunks, meta and resets embedded videos', () => {
    seedVideo(t, 'vid-a', sourceId);
    t.db
      .update(videos)
      .set({ status: 'embedded', embeddedAt: new Date().toISOString() })
      .where(eq(videos.id, 'vid-a'))
      .run();
    insertChunk(t, 'c1', 'vid-a', sourceId);
    ensureVecChunksTable(t.db, 4);
    insertChunkVectors(t.db, [{ chunkId: 'c1', sourceId, embedding: [1, 0, 0, 0] }]);
    setEmbedState(t.db, { model: 'test/embed-model', dimension: 4 });

    resetAllEmbeddings(t.db);

    expect(vecTableExists(t.db)).toBe(false);
    expect(getEmbedState(t.db)).toBeNull();
    expect(t.db.select().from(chunks).all()).toHaveLength(0);
    expect(t.db.select().from(videos).where(eq(videos.id, 'vid-a')).get()).toMatchObject({
      status: 'fetched',
      embeddedAt: null,
    });
  });
});
