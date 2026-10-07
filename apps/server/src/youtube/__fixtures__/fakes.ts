// Fixture-backed fakes of the InnertubeLike boundary — tests never touch the
// network. Fixtures are plain JSON (strings where youtubei.js has Text
// objects); the wrappers here convert known text-ish fields to TextLike so
// production normalization runs against shapes matching the real client.

import type {
  ChannelLike,
  FeedPageLike,
  InnertubeLike,
  PlaylistLike,
  TextLike,
  TranscriptInfoLike,
  VideoInfoLike,
} from '../types.js';

export const t = (value: string): TextLike => ({ toString: () => value });

/** Fields that hold a Text object in real youtubei.js nodes. */
const TEXT_KEYS = new Set([
  'title',
  'published',
  'primary_text',
  'secondary_text',
  'name',
  'snippet',
  'accessibility_text',
]);

/** Recursively wrap known text-ish string fields into TextLike. */
export function wrapTexts<T>(value: T): T {
  if (Array.isArray(value)) return value.map(wrapTexts) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = TEXT_KEYS.has(key) && typeof v === 'string' ? t(v) : wrapTexts(v);
    }
    return out as T;
  }
  return value;
}

/** Records which client methods were called (tab/filter assertions). */
export interface CallLog {
  calls: { method: string; arg?: string }[];
}

export function newCallLog(): CallLog {
  return { calls: [] };
}

// --- Fixture shapes (structural; imported JSON is assignable to these) -----

export interface FeedPageFixture {
  videos?: unknown[];
  items?: unknown[];
  hasContinuation: boolean;
}

export interface ChannelFixture {
  metadata?: { title?: string; avatar?: { url: string; width: number; height: number }[] };
  tabs?: Partial<Record<'videos' | 'shorts' | 'live', { pages: FeedPageFixture[] }>>;
}

export interface PlaylistFixture {
  info?: {
    title?: string;
    total_items?: string;
    thumbnails?: { url: string; width: number; height: number }[];
  };
  pages?: FeedPageFixture[];
}

export interface TranscriptFixture {
  videoId: string;
  captions?: {
    caption_tracks?: { language_code: string; kind?: string; name?: string }[];
    audio_tracks?: { default_caption_track_index?: number }[];
    default_audio_track_index?: number;
  };
  transcript: {
    selectedLanguage?: string;
    segments: (
      | { text: string; start_ms: string | number; end_ms: string | number }
      | {
          kind: string;
          title: string;
        }
    )[];
  };
}

// --- Builders --------------------------------------------------------------

export function fakeFeed(pages: FeedPageFixture[], log?: CallLog): FeedPageLike {
  const makePage = (index: number): FeedPageLike => {
    const page = pages[index];
    if (!page) throw new Error(`fixture page ${index} missing`);
    return {
      videos: page.videos ? wrapTexts(page.videos) : undefined,
      items: page.items ? wrapTexts(page.items) : undefined,
      has_continuation: page.hasContinuation,
      getContinuation: async () => {
        log?.calls.push({ method: 'getContinuation' });
        return makePage(index + 1);
      },
    };
  };
  return makePage(0);
}

export function fakeChannel(fixture: ChannelFixture, log?: CallLog): ChannelLike {
  const tab = (name: 'videos' | 'shorts' | 'live'): FeedPageLike => {
    log?.calls.push({ method: `channel.${name}` });
    const pages = fixture.tabs?.[name]?.pages;
    if (!pages) throw new Error(`fixture has no ${name} tab`);
    return fakeFeed(pages, log);
  };
  return {
    metadata: fixture.metadata,
    // Every fixture channel offers all three tabs.
    has_videos: true,
    has_shorts: true,
    has_live_streams: true,
    getVideos: () => Promise.resolve(tab('videos')),
    getShorts: () => Promise.resolve(tab('shorts')),
    getLiveStreams: () => Promise.resolve(tab('live')),
    has_continuation: false,
    getContinuation: () => Promise.reject(new Error('channel page continuation not faked')),
  };
}

export function fakePlaylist(fixture: PlaylistFixture, log?: CallLog): PlaylistLike {
  return {
    ...fakeFeed(fixture.pages ?? [{ hasContinuation: false }], log),
    info: fixture.info ?? {},
  };
}

export function fakeTranscriptInfo(fixture: TranscriptFixture['transcript']): TranscriptInfoLike {
  return {
    selectedLanguage: fixture.selectedLanguage,
    transcript: {
      content: {
        body: {
          initial_segments: fixture.segments.map((segment) =>
            'text' in segment
              ? { snippet: t(segment.text), start_ms: segment.start_ms, end_ms: segment.end_ms }
              : { title: t(segment.title) },
          ),
        },
      },
    },
  };
}

export function fakeVideoInfo(fixture: TranscriptFixture): VideoInfoLike {
  return {
    basic_info: { id: fixture.videoId, title: `video ${fixture.videoId}` },
    captions: fixture.captions ? wrapTexts(fixture.captions) : undefined,
    getTranscript: () => Promise.resolve(fakeTranscriptInfo(fixture.transcript)),
  };
}

export interface FakeInnertubeHandlers {
  /** url → browseId */
  resolveURL?: Record<string, string>;
  channels?: Record<string, ChannelLike>;
  playlists?: Record<string, PlaylistLike>;
  /** videoId → info, used for both getBasicInfo and getInfo */
  videoInfos?: Record<string, VideoInfoLike>;
}

export function fakeInnertube(
  handlers: FakeInnertubeHandlers,
  log: CallLog = newCallLog(),
): InnertubeLike & { log: CallLog } {
  const lookup = <T>(table: Record<string, T> | undefined, key: string, what: string): T => {
    const hit = table?.[key];
    if (!hit) throw new Error(`fake Innertube: no ${what} fixture for ${key}`);
    return hit;
  };
  return {
    log,
    resolveURL: (url) => {
      log.calls.push({ method: 'resolveURL', arg: url });
      const browseId = lookup(handlers.resolveURL, url, 'resolveURL');
      return Promise.resolve({ payload: { browseId } });
    },
    getChannel: (id) => {
      log.calls.push({ method: 'getChannel', arg: id });
      return Promise.resolve(lookup(handlers.channels, id, 'channel'));
    },
    getPlaylist: (id) => {
      log.calls.push({ method: 'getPlaylist', arg: id });
      return Promise.resolve(lookup(handlers.playlists, id, 'playlist'));
    },
    getBasicInfo: (videoId) => {
      log.calls.push({ method: 'getBasicInfo', arg: videoId });
      return Promise.resolve(lookup(handlers.videoInfos, videoId, 'video info'));
    },
    getInfo: (videoId) => {
      log.calls.push({ method: 'getInfo', arg: videoId });
      return Promise.resolve(lookup(handlers.videoInfos, videoId, 'video info'));
    },
  };
}
