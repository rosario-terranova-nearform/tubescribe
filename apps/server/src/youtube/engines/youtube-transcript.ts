// Fallback transcript engine wrapping the `youtube-transcript` package
// (v1.3.x API). The fetch function is injected so tests never do network.
//
// Caveats of the package, handled here:
// - Mixed units: its srv3 XML parser yields integer milliseconds, its classic
//   <text start dur> parser yields float seconds, and nothing says which.
// - It doesn't expose caption kind (manual vs asr) → captionKind is null.

import {
  type TranscriptResponse,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  fetchTranscript,
} from 'youtube-transcript';
import type { TranscriptResult, TranscriptSegment } from '../types.js';
import { type TranscriptEngine, TranscriptError } from './engine.js';

export type FetchTranscriptFn = (videoId: string) => Promise<TranscriptResponse[]>;

export class YoutubeTranscriptEngine implements TranscriptEngine {
  readonly name = 'youtube-transcript' as const;
  readonly #fetchImpl: FetchTranscriptFn;

  constructor(fetchImpl: FetchTranscriptFn = fetchTranscript) {
    this.#fetchImpl = fetchImpl;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    let items: TranscriptResponse[];
    try {
      items = await this.#fetchImpl(videoId);
    } catch (err) {
      throw classifyPackageError(err, videoId);
    }
    if (items.length === 0) {
      throw new TranscriptError('unavailable', videoId, 'transcript is empty');
    }

    const ms = usesMilliseconds(items);
    const segments: TranscriptSegment[] = items.map((item) => {
      const startMs = ms ? Math.round(item.offset) : Math.round(item.offset * 1000);
      const endMs = ms
        ? Math.round(item.offset + item.duration)
        : Math.round((item.offset + item.duration) * 1000);
      return { text: item.text, startMs, endMs };
    });

    return {
      segments,
      fullText: segments.map((s) => s.text).join('\n'),
      language: items[0]?.lang ?? 'und',
      captionKind: null,
      engine: this.name,
    };
  }
}

/**
 * Decide whether offset/duration are milliseconds (srv3 parser) or seconds
 * (classic parser). The reliable tell: srv3 durations are integer ms (always
 * well over 100), while a classic caption never runs anywhere near 100 s.
 */
function usesMilliseconds(items: readonly TranscriptResponse[]): boolean {
  return items.some((item) => item.duration > 100);
}

function classifyPackageError(err: unknown, videoId: string): unknown {
  if (err instanceof YoutubeTranscriptTooManyRequestError) {
    return new TranscriptError('rate-limited', videoId, err.message, { cause: err });
  }
  if (err instanceof YoutubeTranscriptDisabledError) {
    return new TranscriptError('disabled', videoId, err.message, { cause: err });
  }
  if (
    err instanceof YoutubeTranscriptNotAvailableError ||
    err instanceof YoutubeTranscriptVideoUnavailableError ||
    err instanceof YoutubeTranscriptNotAvailableLanguageError
  ) {
    return new TranscriptError('unavailable', videoId, err.message, { cause: err });
  }
  return err;
}
