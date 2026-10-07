// Async generator listing a source's videos with continuation handling.
//
// - channel: one feed per enabled type-filter tab (uploads / shorts / live),
//   following continuations until exhausted; ids are deduped across tabs
//   (a livestream is also an upload).
// - playlist: every item, following continuations. The type filter can't be
//   applied cheaply to playlist items, so playlists list everything.
// - video: yields the single video.
//
// Feed nodes arrive as whatever youtubei.js parsed (Video, GridVideo,
// PlaylistVideo, ReelItem, ShortsLockupView, LockupView, …), so they are
// duck-typed rather than instanceof-checked — which also keeps the Like
// boundary fakeable from fixtures.

import type { SourceKind, SourceTypeFilter } from '@tubescribe/shared';
import type { DiscoveredVideo, FeedPageLike, InnertubeLike, TextLike } from './types.js';

export interface ListableSource {
  kind: SourceKind;
  identifier: string;
}

const CHANNEL_TABS = [
  ['uploads', 'getVideos', 'has_videos'],
  ['shorts', 'getShorts', 'has_shorts'],
  ['live', 'getLiveStreams', 'has_live_streams'],
] as const;

export async function* listSourceVideos(
  client: InnertubeLike,
  source: ListableSource,
  typeFilter: SourceTypeFilter,
): AsyncGenerator<DiscoveredVideo> {
  if (source.kind === 'video') {
    const info = await client.getBasicInfo(source.identifier);
    yield {
      videoId: source.identifier,
      title: info.basic_info.title ?? '',
      publishedAt: info.basic_info.start_timestamp?.toISOString() ?? null,
      durationS: info.basic_info.duration ?? 0,
    };
    return;
  }

  const seen = new Set<string>();
  const emit = function* (node: unknown): Generator<DiscoveredVideo> {
    const video = normalizeVideoNode(node);
    if (video && !seen.has(video.videoId)) {
      seen.add(video.videoId);
      yield video;
    }
  };

  if (source.kind === 'playlist') {
    const playlist = await client.getPlaylist(source.identifier);
    yield* paginate(playlist, (page) => page.items ?? [], emit);
    return;
  }

  const channel = await client.getChannel(source.identifier);
  for (const [filterKey, tabMethod, hasFlag] of CHANNEL_TABS) {
    if (!typeFilter[filterKey]) continue;
    // Skip tabs the channel doesn't have (when the client tells us).
    if (channel[hasFlag] === false) continue;
    const tab = await channel[tabMethod]();
    yield* paginate(tab, (page) => page.videos ?? [], emit);
  }
}

async function* paginate(
  firstPage: FeedPageLike,
  pick: (page: FeedPageLike) => readonly unknown[],
  emit: (node: unknown) => Generator<DiscoveredVideo>,
): AsyncGenerator<DiscoveredVideo> {
  let page: FeedPageLike | undefined = firstPage;
  while (page) {
    for (const node of pick(page)) {
      yield* emit(node);
    }
    page = page.has_continuation ? await page.getContinuation() : undefined;
  }
}

// --- Node normalization ----------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.toString === 'function') {
    const s = (value as TextLike).toString();
    return typeof s === 'string' && s.length > 0 ? s : undefined;
  }
  return undefined;
}

/** Video / GridVideo / CompactVideo — identified by `video_id`. */
function fromVideoNode(node: Record<string, unknown>): DiscoveredVideo | null {
  if (typeof node.video_id !== 'string' || node.video_id.length === 0) return null;
  return {
    videoId: node.video_id,
    title: textOf(node.title) ?? '',
    publishedAt: toIsoDate(textOf(node.published)),
    durationS: durationOf(node),
  };
}

function durationOf(node: Record<string, unknown>): number {
  // Video/PlaylistVideo: { text, seconds }. GridVideo: a Text like "1:02:03".
  const d = node.duration;
  if (isRecord(d) && typeof d.seconds === 'number' && Number.isFinite(d.seconds)) {
    return d.seconds;
  }
  const asText = textOf(d);
  return (asText && parseDurationText(asText)) || 0;
}

/** "12:34" → 754, "1:02:03" → 3723. Returns null when unparseable. */
function parseDurationText(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    seconds = seconds * 60 + Number.parseInt(part, 10);
  }
  return seconds;
}

/** ShortsLockupView — identified by `entity_id` / `on_tap_endpoint`. */
function fromShortsLockup(node: Record<string, unknown>): DiscoveredVideo | null {
  if (typeof node.entity_id !== 'string' && !isRecord(node.on_tap_endpoint)) return null;
  const payload = isRecord(node.on_tap_endpoint) ? node.on_tap_endpoint.payload : undefined;
  const fromEndpoint = isRecord(payload) ? payload.videoId : undefined;
  const entityMatch =
    typeof node.entity_id === 'string'
      ? node.entity_id.match(/shorts-shelf-item-([A-Za-z0-9_-]{11})/)
      : null;
  const videoId = typeof fromEndpoint === 'string' ? fromEndpoint : entityMatch?.[1];
  if (!videoId) return null;
  const overlay = isRecord(node.overlay_metadata) ? node.overlay_metadata : undefined;
  return {
    videoId,
    title: (overlay && textOf(overlay.primary_text)) || textOf(node.accessibility_text) || '',
    publishedAt: null,
    durationS: 0,
  };
}

/** LockupView — generic node; only video/short content is listed. */
function fromLockupView(node: Record<string, unknown>): DiscoveredVideo | null {
  if (typeof node.content_id !== 'string' || node.content_id.length === 0) return null;
  if (node.content_type !== 'VIDEO' && node.content_type !== 'SHORT') return null;
  const metadata = isRecord(node.metadata) ? node.metadata : undefined;
  return {
    videoId: node.content_id,
    title: (metadata && textOf(metadata.title)) || '',
    publishedAt: null,
    durationS: 0,
  };
}

/** PlaylistVideo / ReelItem — both carry a bare `id`. */
function fromIdNode(node: Record<string, unknown>): DiscoveredVideo | null {
  if (typeof node.id !== 'string' || node.id.length === 0) return null;
  return {
    videoId: node.id,
    title: textOf(node.title) ?? '',
    publishedAt: null,
    durationS: durationOf(node),
  };
}

export function normalizeVideoNode(node: unknown): DiscoveredVideo | null {
  if (!isRecord(node)) return null;
  return fromVideoNode(node) ?? fromLockupView(node) ?? fromShortsLockup(node) ?? fromIdNode(node);
}

/**
 * Best-effort absolute-date parse ("Mar 5, 2023"). Relative dates ("3 days
 * ago") and unparsable text yield null. Parsed as a calendar date (UTC) so
 * the result doesn't shift with the server's timezone.
 */
function toIsoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
  ).toISOString();
}
