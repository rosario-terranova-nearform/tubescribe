// Embedding client: OpenRouter via the Vercel AI SDK (`embedMany` with
// `openrouter.textEmbeddingModel(...)`). Texts are batched (100 per call) and
// each batch retries transient failures with jittered backoff. Tests inject a
// fake Embedder (testing/fake-embedder.ts) — no live network, ever.

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { embedMany } from 'ai';
import type { Logger } from 'pino';
import { withBackoff } from '../jobs/backoff.js';

/** Texts per `embedMany` call. */
export const EMBED_BATCH_SIZE = 100;

/**
 * The injected client boundary for embeddings (analogous to TranscriptEngine
 * for youtube). `embed` returns one vector per input text, same order.
 */
export interface Embedder {
  embed(model: string, texts: string[]): Promise<number[][]>;
}

export interface OpenRouterEmbedderDeps {
  /** From config.openrouterApiKey. Empty/missing → requests fail with 401. */
  apiKey: string | undefined;
  logger?: Logger;
  batchSize?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Test seam: replaces the AI SDK embedMany call (no network in tests). */
  embedBatch?: (model: string, values: string[]) => Promise<number[][]>;
}

/** Transient failures: network errors (no status), 429, and 5xx. */
function isRetryable(err: unknown): boolean {
  const status = (err as { statusCode?: unknown })?.statusCode;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createOpenRouterEmbedder(deps: OpenRouterEmbedderDeps): Embedder {
  // '' (not undefined) so the provider never falls back to reading
  // OPENROUTER_API_KEY from process.env itself — env access is config-only.
  const openrouter = createOpenRouter({ apiKey: deps.apiKey ?? '' });
  const embedBatch =
    deps.embedBatch ??
    (async (model: string, values: string[]) => {
      // The AI SDK's own retry loop is disabled: backoff policy lives here,
      // with injected sleep/random like the transcript pipeline.
      const result = await embedMany({
        model: openrouter.textEmbeddingModel(model),
        values,
        maxRetries: 0,
      });
      deps.logger?.debug(
        { model, texts: values.length, tokens: result.usage.tokens },
        'embedding batch done',
      );
      return result.embeddings.map((e) => [...e]);
    });
  const batchSize = deps.batchSize ?? EMBED_BATCH_SIZE;
  const maxRetries = deps.maxRetries ?? 3;
  const sleep = deps.sleep ?? realSleep;
  const random = deps.random ?? Math.random;

  return {
    async embed(model, texts) {
      const embeddings: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const values = texts.slice(i, i + batchSize);
        const batch = await withBackoff(() => embedBatch(model, values), {
          baseMs: 500,
          capMs: 30_000,
          maxRetries,
          sleep,
          random,
          shouldRetry: isRetryable,
          onRetry: (err, attempt, delayMs) =>
            deps.logger?.warn(
              { model, batch: i / batchSize, attempt, delayMs, err },
              'embedding batch failed; backing off',
            ),
        });
        embeddings.push(...batch);
      }
      return embeddings;
    },
  };
}
