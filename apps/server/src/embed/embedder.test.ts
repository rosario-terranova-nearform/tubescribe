// Embedder batching + retry policy, via the injected embedBatch seam (the
// real one wraps the AI SDK's embedMany with OpenRouter; no network here).

import { describe, expect, it } from 'vitest';
import { EMBED_BATCH_SIZE, createOpenRouterEmbedder } from './embedder.js';

function apiError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

describe('createOpenRouterEmbedder', () => {
  it('batches texts into groups of batchSize', async () => {
    const batches: string[][] = [];
    const embedder = createOpenRouterEmbedder({
      apiKey: 'test',
      batchSize: 3,
      embedBatch: (_model, values) => {
        batches.push(values);
        return Promise.resolve(values.map(() => [0.1]));
      },
    });
    const texts = Array.from({ length: 8 }, (_, i) => `t${i}`);

    const embeddings = await embedder.embed('m', texts);

    expect(batches.map((b) => b.length)).toEqual([3, 3, 2]);
    expect(embeddings).toHaveLength(8);
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const embedder = createOpenRouterEmbedder({
      apiKey: 'test',
      maxRetries: 2,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
      embedBatch: () => {
        attempts += 1;
        if (attempts < 3) return Promise.reject(apiError(429, 'rate limited'));
        return Promise.resolve([[1, 2]]);
      },
    });

    await expect(embedder.embed('m', ['x'])).resolves.toEqual([[1, 2]]);
    expect(attempts).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry non-retryable errors (4xx other than 429)', async () => {
    let attempts = 0;
    const embedder = createOpenRouterEmbedder({
      apiKey: 'test',
      maxRetries: 3,
      sleep: () => Promise.resolve(),
      embedBatch: () => {
        attempts += 1;
        return Promise.reject(apiError(400, 'bad request'));
      },
    });

    await expect(embedder.embed('m', ['x'])).rejects.toThrow('bad request');
    expect(attempts).toBe(1);
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    let attempts = 0;
    const embedder = createOpenRouterEmbedder({
      apiKey: 'test',
      maxRetries: 1,
      sleep: () => Promise.resolve(),
      embedBatch: () => {
        attempts += 1;
        return Promise.reject(apiError(500, 'server error'));
      },
    });

    await expect(embedder.embed('m', ['x'])).rejects.toThrow('server error');
    expect(attempts).toBe(2);
  });

  it('defaults to a batch size of 100', () => {
    expect(EMBED_BATCH_SIZE).toBe(100);
  });
});
