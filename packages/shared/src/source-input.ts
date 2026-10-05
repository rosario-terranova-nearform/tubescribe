// @tubescribe/shared: smart source-input parser
// Accepts anything a user pastes — bare ids, @handles, urls (channel / playlist
// / video / shorts / youtu.be) — and returns a normalized `{ kind, identifier }`.
// Lives in shared so the web app can pre-validate before calling
// `/api/sources/resolve`. Garbage input throws `SourceInputError`.

import { type SourceInput, SourceInputSchema } from './domain.js';

export class SourceInputError extends Error {
  readonly code = 'SOURCE_INPUT_INVALID' as const;
  readonly raw: string;

  constructor(message: string, raw: string) {
    super(message);
    this.name = 'SourceInputError';
    this.raw = raw;
  }
}

// --- Identifier shapes ---------------------------------------------------

// YouTube channel @handles: 3-30 chars, alphanum + dot/underscore/dash.
const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;

// YouTube channel id: 24 chars starting with "UC".
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

// YouTube playlist id: PL / UU / OL / FL / LP / EC prefix + alphanum.
const PLAYLIST_PREFIXES = ['PL', 'UU', 'OL', 'FL', 'LP', 'EC'] as const;
const PLAYLIST_ID_BARE_RE = new RegExp(`^(?:${PLAYLIST_PREFIXES.join('|')})[A-Za-z0-9_-]{10,}$`);
const PLAYLIST_ID_VALUE_RE = new RegExp(`^(?:${PLAYLIST_PREFIXES.join('|')})[A-Za-z0-9_-]{10,}$`);

// YouTube video id: 11 chars, alphanum + dash + underscore.
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Things that look like a YouTube URL or are explicitly schemes.
const URLISH_RE = /^https?:\/\//i;
// Strings that lack a scheme but clearly refer to youtube.
const YOUTUBE_HOST_PREFIX_RE = /^(?:www\.|m\.)?youtube\.com\//i;
const YOUTU_BE_PREFIX_RE = /^youtu\.be\//i;

// --- URL helpers ---------------------------------------------------------

function asUrl(rawInput: string): URL | null {
  if (URLISH_RE.test(rawInput)) {
    try {
      return new URL(rawInput);
    } catch {
      return null;
    }
  }
  if (YOUTUBE_HOST_PREFIX_RE.test(rawInput) || YOUTU_BE_PREFIX_RE.test(rawInput)) {
    try {
      return new URL(`https://${rawInput}`);
    } catch {
      return null;
    }
  }
  return null;
}

function isYoutubeHost(host: string): boolean {
  return /^(?:[\w-]+\.)?youtube\.com$/i.test(host) || /^youtu\.be$/i.test(host);
}

function identifierOfPlaylist(value: string | null): string | null {
  if (!value) return null;
  return PLAYLIST_ID_VALUE_RE.test(value) ? value : null;
}

function channelFromHandle(handle: string): SourceInput {
  const normalized = handle.replace(/^@/, '');
  return { kind: 'channel', identifier: `@${normalized}` };
}

function parseFromUrl(rawInput: string, url: URL): SourceInput {
  if (!isYoutubeHost(url.hostname)) {
    throw new SourceInputError(`unsupported host: ${url.hostname}`, rawInput);
  }
  const segments = url.pathname.split('/').filter(Boolean);

  // /playlist?list=...
  if (segments[0] === 'playlist') {
    const list = identifierOfPlaylist(url.searchParams.get('list'));
    if (list) return { kind: 'playlist', identifier: list };
    throw new SourceInputError('playlist URL missing list param', rawInput);
  }

  // /watch?v=...&list=...  (list takes precedence, matching YouTube behavior)
  if (segments[0] === 'watch') {
    const list = identifierOfPlaylist(url.searchParams.get('list'));
    if (list) return { kind: 'playlist', identifier: list };
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return { kind: 'video', identifier: v };
    throw new SourceInputError('watch URL missing v or list param', rawInput);
  }

  // /shorts/<videoId>
  if (segments[0] === 'shorts' && segments[1] && VIDEO_ID_RE.test(segments[1])) {
    return { kind: 'video', identifier: segments[1] };
  }

  // /channel/UCxxxx
  if (segments[0] === 'channel' && segments[1] && CHANNEL_ID_RE.test(segments[1])) {
    return { kind: 'channel', identifier: segments[1] };
  }

  // Legacy /user/<name> and /c/<name> still resolve — treat as handle.
  if ((segments[0] === 'user' || segments[0] === 'c') && segments[1]) {
    if (HANDLE_RE.test(segments[1])) return channelFromHandle(segments[1]);
    throw new SourceInputError(`invalid /${segments[0]}/<name>: ${segments[1]}`, rawInput);
  }

  // /@handle
  if (segments[0]?.startsWith('@')) {
    const handle = segments[0].slice(1);
    if (HANDLE_RE.test(handle)) return channelFromHandle(handle);
    throw new SourceInputError(`invalid /@<handle>: ${segments[0]}`, rawInput);
  }

  // youtu.be/<videoId>
  if (url.hostname === 'youtu.be' && segments[0] && VIDEO_ID_RE.test(segments[0])) {
    return { kind: 'video', identifier: segments[0] };
  }

  throw new SourceInputError(`could not extract source from URL: ${url.toString()}`, rawInput);
}

function parseBare(input: string): SourceInput {
  if (CHANNEL_ID_RE.test(input)) return { kind: 'channel', identifier: input };
  if (PLAYLIST_ID_BARE_RE.test(input)) return { kind: 'playlist', identifier: input };
  if (VIDEO_ID_RE.test(input)) return { kind: 'video', identifier: input };
  throw new SourceInputError(`not a recognizable identifier: ${input}`, input);
}

// --- Public parse fn -----------------------------------------------------

/**
 * Parse a user-pasted string into a normalized source reference. Throws
 * `SourceInputError` on garbage so callers can surface the same message in
 * the UI without trying to be clever about format detection.
 */
export function parseSourceInput(raw: string): SourceInput {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new SourceInputError('empty input', raw);
  }

  const url = asUrl(trimmed);
  if (url) {
    return SourceInputSchema.parse(parseFromUrl(trimmed, url));
  }

  // Bare @handle (no scheme, no path) — handle is everything after "@".
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1);
    if (HANDLE_RE.test(handle)) return SourceInputSchema.parse(channelFromHandle(handle));
    throw new SourceInputError(`invalid @handle: ${trimmed}`, raw);
  }

  return SourceInputSchema.parse(parseBare(trimmed));
}

// Internal exports for tests.
export const __internals = {
  CHANNEL_ID_RE,
  PLAYLIST_ID_BARE_RE,
  VIDEO_ID_RE,
  HANDLE_RE,
};
