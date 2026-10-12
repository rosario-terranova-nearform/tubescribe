// Fake Embedder for tests — deterministic vectors, no network, ever.
// Excluded from the production build (see tsconfig.build.json).

import type { Embedder } from '../embed/embedder.js';

export interface EmbedCall {
  model: string;
  texts: string[];
}

export interface FakeEmbedder extends Embedder {
  /** Calls passed to embed(), in order. */
  calls: EmbedCall[];
}

/** Deterministic uint8-ish hash of a string (FNV-1a). */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Default vector: deterministic per text — the same text always yields the
 * same unit-ish vector (distance 0 to itself), different texts get
 * pseudo-random directions (a mulberry32 PRNG seeded by the text hash).
 */
function defaultVector(text: string, dimension: number): number[] {
  let state = hashText(text);
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: dimension }, () => next() * 2 - 1);
}

export interface FakeEmbedderOptions {
  /** Vector dimension (default 8; text-embedding-3-small would be 1536). */
  dimension?: number;
  /** Override the embedding computation entirely (e.g. scripted failures). */
  embed?: (model: string, texts: string[]) => number[][];
}

export function fakeEmbedder(options: FakeEmbedderOptions = {}): FakeEmbedder {
  const dimension = options.dimension ?? 8;
  const calls: EmbedCall[] = [];
  return {
    calls,
    embed(model, texts) {
      calls.push({ model, texts });
      const embeddings = options.embed
        ? options.embed(model, texts)
        : texts.map((t) => defaultVector(t, dimension));
      return Promise.resolve(embeddings);
    },
  };
}
