// TranscriptEngine: the injectable boundary for transcript fetching.
// The extraction worker (task 05) chains engines (youtubei.js → youtubei.js
// TV_EMBEDDED → youtube-transcript) and records which one succeeded.

import type { Engine } from '@tubescribe/shared';
import type { TranscriptResult } from '../types.js';

export type TranscriptErrorCode = 'unavailable' | 'disabled' | 'rate-limited';

/**
 * Typed transcript-fetch failure:
 * - `unavailable`: the video has no transcript (no captions / panel missing).
 * - `disabled`: captions exist but are disabled for this video.
 * - `rate-limited`: bot detection / transient server or network failure —
 *   retryable with backoff (400/429/LOGIN_REQUIRED, 5xx, fetch failures).
 *
 * Errors that are NOT recognized transcript-domain failures (programming
 * bugs, unexpected shapes) propagate unwrapped so they can't masquerade as
 * "video has no transcript".
 */
export class TranscriptError extends Error {
  override readonly name = 'TranscriptError';
  readonly code: TranscriptErrorCode;
  readonly videoId: string;

  constructor(
    code: TranscriptErrorCode,
    videoId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.videoId = videoId;
  }
}

export interface TranscriptEngine {
  /** Engine name as recorded per video (shared `Engine` enum). */
  readonly name: Engine;
  fetch(videoId: string): Promise<TranscriptResult>;
}
