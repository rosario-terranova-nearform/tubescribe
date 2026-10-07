// YouTube service boundary types.
//
// All YouTube access goes through the `*Like` interfaces here: a narrow,
// structural slice of youtubei.js that the real `Innertube` satisfies and
// tests fake from recorded fixtures. No route or job code touches
// youtubei.js directly (see AGENTS.md / docs/DESIGN.md bot-detection notes).

import type { CaptionKind, Engine, SourceKind } from '@tubescribe/shared';

/** A video discovered while listing a source. */
export interface DiscoveredVideo {
  videoId: string;
  title: string;
  /** ISO 8601 datetime, or null when YouTube exposes no parseable date. */
  publishedAt: string | null;
  durationS: number;
}

/** Canonical result of resolving a pasted source (confirmation card data). */
export interface ResolvedSource {
  kind: SourceKind;
  /** Canonical identifier: channel handles resolve to their UC id. */
  identifier: string;
  title: string;
  thumbnailUrl: string | null;
  videoCount?: number;
}

export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  /** Segment texts joined with newlines. */
  fullText: string;
  /** Language code of the fetched caption track ('und' when unknown). */
  language: string;
  /** null when the engine cannot tell (youtube-transcript doesn't expose it). */
  captionKind: CaptionKind | null;
  engine: Engine;
}

// --- Client boundary -------------------------------------------------------
// The minimal youtubei.js surface this app uses. Kept deliberately narrow so
// tests can inject fixtures without constructing real YT node classes.

export interface TextLike {
  toString(): string;
}

export interface ThumbnailLike {
  url: string;
  width: number;
  height: number;
}

export interface NavigationEndpointLike {
  payload: Record<string, unknown>;
}

/**
 * One page of a continuable feed. Channel tabs expose `videos`, playlists
 * expose `items`; `getContinuation` returns the next page (same shape).
 */
export interface FeedPageLike {
  readonly videos?: readonly unknown[];
  readonly items?: readonly unknown[];
  readonly has_continuation: boolean;
  getContinuation(): Promise<FeedPageLike>;
}

export interface ChannelLike extends FeedPageLike {
  metadata?: {
    title?: string;
    avatar?: ThumbnailLike[];
  };
  /** Tab presence flags — checked before requesting a tab when available. */
  readonly has_videos?: boolean;
  readonly has_shorts?: boolean;
  readonly has_live_streams?: boolean;
  getVideos(): Promise<FeedPageLike>;
  getShorts(): Promise<FeedPageLike>;
  getLiveStreams(): Promise<FeedPageLike>;
}

export interface PlaylistInfoLike {
  title?: string;
  thumbnails?: ThumbnailLike[];
  /** Rendered count, e.g. "1,234" — parse, don't trust the format. */
  total_items?: string;
}

export type PlaylistLike = FeedPageLike & { info: PlaylistInfoLike };

export interface CaptionTrackLike {
  language_code: string;
  /** 'asr' = auto-generated; undefined/'frc' = manual. */
  kind?: string;
  name?: TextLike;
}

export interface CaptionTracklistLike {
  caption_tracks?: CaptionTrackLike[];
  audio_tracks?: { default_caption_track_index?: number }[];
  default_audio_track_index?: number;
}

export interface VideoBasicInfoLike {
  id?: string;
  title?: string;
  duration?: number;
  /** Set for live/premiere videos; regular uploads expose no date here. */
  start_timestamp?: Date | null;
  thumbnail?: ThumbnailLike[];
}

/** A TranscriptSegment node (TranscriptSectionHeader nodes lack these). */
export interface TranscriptSegmentNodeLike {
  start_ms: string | number;
  end_ms: string | number;
  snippet: TextLike;
}

export interface TranscriptInfoLike {
  transcript?: {
    content?: {
      body?: { initial_segments?: readonly unknown[] } | null;
    } | null;
  };
  /** Display title of the selected language (e.g. "English"), not a code. */
  selectedLanguage?: string;
}

export interface VideoInfoLike {
  basic_info: VideoBasicInfoLike;
  captions?: CaptionTracklistLike | null;
  getTranscript(): Promise<TranscriptInfoLike>;
}

/** The slice of youtubei.js `Innertube` the app uses. Tests inject fakes. */
export interface InnertubeLike {
  resolveURL(url: string): Promise<NavigationEndpointLike>;
  getChannel(id: string): Promise<ChannelLike>;
  getPlaylist(id: string): Promise<PlaylistLike>;
  getBasicInfo(videoId: string): Promise<VideoInfoLike>;
  getInfo(videoId: string): Promise<VideoInfoLike>;
}

/** Lazily creates (and lets engines cache) a client — creation may do I/O. */
export type InnertubeFactory = () => Promise<InnertubeLike>;
