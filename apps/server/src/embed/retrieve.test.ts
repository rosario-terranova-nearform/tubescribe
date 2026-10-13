// Retrieval: top-k cosine scoped to the bot's attached sources only, with
// citation metadata. Vectors come from the deterministic fake embedder.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botSources, bots, chunks, videos } from '../db/schema.js';
import { fakeEmbedder } from '../testing/fake-embedder.js';
import { type TestDb, makeTestDb, seedSource } from '../testing/test-db.js';
import { DEFAULT_TOP_K, retrieveForBot } from './retrieve.js';
import { ensureVecChunksTable, insertChunkVectors, setEmbedState } from './vec.js';

const MODEL = 'test/embed-model';

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
      status: 'embedded',
      fetchedAt: new Date().toISOString(),
      embeddedAt: new Date().toISOString(),
    })
    .run();
}

function seedEmbeddedChunk(
  t: TestDb,
  chunk: { id: string; videoId: string; sourceId: string; title: string; text: string },
): void {
  t.db
    .insert(chunks)
    .values({ ...chunk, startMs: 0, endMs: 1500 })
    .run();
  // Same deterministic vectors the fake embedder produces for queries.
  insertChunkVectors(t.db, [
    { chunkId: chunk.id, sourceId: chunk.sourceId, embedding: deterministicVector(chunk.text) },
  ]);
}

// Keep in sync with fake-embedder's default: FNV-1a hash → mulberry32 vector.
function deterministicVector(text: string, dimension = 8): number[] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: dimension }, () => next() * 2 - 1);
}

function seedBot(t: TestDb, botId: string, sourceIds: string[]): void {
  const now = new Date().toISOString();
  t.db
    .insert(bots)
    .values({
      id: botId,
      name: botId,
      systemPrompt: 'sp',
      modelOverride: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  for (const sourceId of sourceIds) {
    t.db.insert(botSources).values({ botId, sourceId }).run();
  }
}

describe('retrieveForBot', () => {
  let t: TestDb;
  let sourceA: string;
  let sourceB: string;
  const embedder = fakeEmbedder();

  beforeEach(() => {
    t = makeTestDb();
    sourceA = seedSource(t.db, { id: 'source-a' });
    sourceB = seedSource(t.db, { id: 'source-b' });
    seedVideo(t, 'vid-a', sourceA);
    seedVideo(t, 'vid-b', sourceB);

    ensureVecChunksTable(t.db, 8);
    setEmbedState(t.db, { model: MODEL, dimension: 8 });
    seedEmbeddedChunk(t, {
      id: 'chunk-a1',
      videoId: 'vid-a',
      sourceId: sourceA,
      title: 'Title vid-a',
      text: 'alpha bravo charlie',
    });
    seedEmbeddedChunk(t, {
      id: 'chunk-a2',
      videoId: 'vid-a',
      sourceId: sourceA,
      title: 'Title vid-a',
      text: 'delta echo foxtrot',
    });
    seedEmbeddedChunk(t, {
      id: 'chunk-b1',
      videoId: 'vid-b',
      sourceId: sourceB,
      title: 'Title vid-b',
      text: 'alpha bravo charlie', // same text exists in the OTHER source
    });
  });

  afterEach(() => {
    t.cleanup();
  });

  it('returns only chunks from the bot’s attached sources, best first', async () => {
    seedBot(t, 'bot-a', [sourceA]);

    const results = await retrieveForBot(
      { db: t.db, embedder },
      { botId: 'bot-a', query: 'alpha bravo charlie' },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.sourceId === sourceA)).toBe(true);
    // Exact text match in source A wins with distance ≈ 0.
    expect(results[0]).toMatchObject({ videoId: 'vid-a', text: 'alpha bravo charlie' });
    expect(results[0]?.distance).toBeCloseTo(0, 5);
    // Citation metadata is present.
    expect(results[0]).toMatchObject({
      sourceId: sourceA,
      title: 'Title vid-a',
      startMs: 0,
      endMs: 1500,
    });
  });

  it('respects k', async () => {
    seedBot(t, 'bot-both', [sourceA, sourceB]);

    const results = await retrieveForBot(
      { db: t.db, embedder },
      { botId: 'bot-both', query: 'alpha bravo charlie', k: 2 },
    );

    expect(results).toHaveLength(2);
    // Both exact matches (both sources) rank above the unrelated chunk.
    expect(results.map((r) => r.text)).toEqual(['alpha bravo charlie', 'alpha bravo charlie']);
  });

  it('a bot attached to both sources sees both', async () => {
    seedBot(t, 'bot-both', [sourceA, sourceB]);

    const results = await retrieveForBot(
      { db: t.db, embedder },
      { botId: 'bot-both', query: 'delta echo foxtrot' },
    );

    expect(new Set(results.map((r) => r.sourceId)).size).toBe(2);
  });

  it('a bot with no sources gets nothing', async () => {
    seedBot(t, 'bot-none', []);
    const callsBefore = embedder.calls.length;

    const results = await retrieveForBot(
      { db: t.db, embedder },
      { botId: 'bot-none', query: 'alpha bravo charlie' },
    );

    expect(results).toEqual([]);
    expect(embedder.calls.length).toBe(callsBefore); // no wasted API call
  });

  it('returns [] when nothing has been embedded yet (no vec table / state)', async () => {
    const empty = makeTestDb();
    try {
      seedBot(empty, 'bot-x', []);
      const results = await retrieveForBot(
        { db: empty.db, embedder },
        { botId: 'bot-x', query: 'anything' },
      );
      expect(results).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });

  it('exposes the default top-k of 8', () => {
    expect(DEFAULT_TOP_K).toBe(8);
  });
});
