// Fake TranscriptEngines for pipeline/worker tests — no network, ever.
// Excluded from the production build (see tsconfig.build.json).

import type { Engine } from '@tubescribe/shared';
import { type TranscriptEngine, TranscriptError } from '../youtube/engines/engine.js';
import type { TranscriptResult } from '../youtube/types.js';

export interface FakeEngine extends TranscriptEngine {
  /** videoIds passed to fetch(), in call order. */
  calls: string[];
}

/**
 * `respond` receives the videoId and the per-video call count (1-based) so
 * tests can script flaky behavior (e.g. fail twice, then succeed).
 */
export function fakeEngine(
  name: Engine,
  respond: (videoId: string, callCount: number) => TranscriptResult | Promise<TranscriptResult>,
): FakeEngine {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  return {
    name,
    calls,
    fetch(videoId: string) {
      calls.push(videoId);
      const count = (counts.get(videoId) ?? 0) + 1;
      counts.set(videoId, count);
      return Promise.resolve(respond(videoId, count));
    },
  };
}

export function okResult(engine: Engine, text = 'hello world'): TranscriptResult {
  const segments = [{ text, startMs: 0, endMs: 1500 }];
  return { segments, fullText: text, language: 'en', captionKind: 'manual', engine };
}

export const alwaysOk = (name: Engine): FakeEngine => fakeEngine(name, () => okResult(name));

export function rateLimited(videoId: string): TranscriptError {
  return new TranscriptError('rate-limited', videoId, '429 Too Many Requests');
}

export function unavailable(videoId: string): TranscriptError {
  return new TranscriptError('unavailable', videoId, 'Transcript panel not found');
}
