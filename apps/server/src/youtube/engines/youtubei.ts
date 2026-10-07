// youtubei.js transcript engine: getInfo → getTranscript.
//
// Used twice in the fallback chain (task 05): with the default client and
// with the TV_EMBEDDED client (workaround for LOGIN_REQUIRED bot detection,
// youtubei.js issue #1119). The client factory is injected so the session is
// created lazily and tests never touch the network.

import type { Engine } from '@tubescribe/shared';
import type {
  CaptionTrackLike,
  InnertubeFactory,
  InnertubeLike,
  TranscriptInfoLike,
  TranscriptResult,
  TranscriptSegment,
  TranscriptSegmentNodeLike,
  VideoInfoLike,
} from '../types.js';
import { type TranscriptEngine, TranscriptError } from './engine.js';

export type YoutubeiEngineName = Extract<Engine, 'youtubei.js' | 'youtubei.js-tv-embedded'>;

export class YoutubeiTranscriptEngine implements TranscriptEngine {
  readonly name: YoutubeiEngineName;
  readonly #factory: InnertubeFactory;
  #client?: InnertubeLike;

  constructor(factory: InnertubeFactory, name: YoutubeiEngineName = 'youtubei.js') {
    this.#factory = factory;
    this.name = name;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    this.#client ??= await this.#factory();
    const client = this.#client;

    let info: VideoInfoLike;
    try {
      info = await client.getInfo(videoId);
    } catch (err) {
      throw classifyInnertubeError(err, videoId);
    }

    let transcriptInfo: TranscriptInfoLike;
    try {
      transcriptInfo = await info.getTranscript();
    } catch (err) {
      throw classifyInnertubeError(err, videoId);
    }

    const segments = normalizeSegments(transcriptInfo);
    if (segments.length === 0) {
      throw new TranscriptError('unavailable', videoId, 'transcript has no segments');
    }

    // getTranscript() fetches the video's default caption track; language and
    // kind come from that track (kind 'asr' = auto-generated). The tracklist's
    // default_audio_track_index/default_caption_track_index points at it.
    const track = selectDefaultCaptionTrack(info);
    return {
      segments,
      fullText: segments.map((s) => s.text).join('\n'),
      language: track?.language_code ?? 'und',
      captionKind: track ? (track.kind === 'asr' ? 'asr' : 'manual') : null,
      engine: this.name,
    };
  }
}

function selectDefaultCaptionTrack(info: VideoInfoLike): CaptionTrackLike | null {
  const tracklist = info.captions;
  const tracks = tracklist?.caption_tracks ?? [];
  if (tracks.length === 0) return null;
  const audio =
    tracklist?.audio_tracks?.[tracklist.default_audio_track_index ?? 0] ??
    tracklist?.audio_tracks?.[0];
  const index = audio?.default_caption_track_index;
  return (typeof index === 'number' ? tracks[index] : undefined) ?? tracks[0] ?? null;
}

function isSegmentNode(node: unknown): node is TranscriptSegmentNodeLike {
  if (typeof node !== 'object' || node === null) return false;
  return 'start_ms' in node && 'end_ms' in node && 'snippet' in node;
}

/** Keep TranscriptSegment nodes (skip section headers), normalize to ms. */
function normalizeSegments(info: TranscriptInfoLike): TranscriptSegment[] {
  const raw = info.transcript?.content?.body?.initial_segments ?? [];
  const segments: TranscriptSegment[] = [];
  for (const node of raw) {
    if (!isSegmentNode(node)) continue;
    const text = node.snippet.toString().trim();
    const startMs = Number(node.start_ms);
    const endMs = Number(node.end_ms);
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    segments.push({ text, startMs, endMs });
  }
  return segments;
}

/**
 * Map youtubei.js failures to typed TranscriptErrors. Known shapes (from the
 * library source):
 * - 'Video is login required' with info.error_type 'LOGIN_REQUIRED' (#1119)
 * - 'Request to <url> failed with status code <n>' (400/429 → #1102, 5xx)
 * - 'Transcript panel not found…', 'Engagement panels not found…',
 *   'Transcript continuation not found.', 'This video is unavailable'
 * Anything unrecognized is rethrown as-is (see TranscriptError docs).
 */
function classifyInnertubeError(err: unknown, videoId: string): unknown {
  if (!(err instanceof Error)) return err;
  const message = err.message;
  const errorType = (err as { info?: { error_type?: unknown } }).info?.error_type;

  const statusMatch = message.match(/failed with status code (\d+)/);
  const status = statusMatch?.[1] ? Number.parseInt(statusMatch[1], 10) : undefined;

  if (
    errorType === 'LOGIN_REQUIRED' ||
    /login.required/i.test(message) ||
    status === 400 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /too many requests/i.test(message) ||
    /fetch failed|network|socket|timed?\s*out/i.test(message)
  ) {
    return new TranscriptError('rate-limited', videoId, message, { cause: err });
  }
  if (/disabled/i.test(message)) {
    return new TranscriptError('disabled', videoId, message, { cause: err });
  }
  if (
    /transcript|unavailable|engagement panels/i.test(message) ||
    (status !== undefined && status >= 400 && status < 500)
  ) {
    return new TranscriptError('unavailable', videoId, message, { cause: err });
  }
  return err;
}
