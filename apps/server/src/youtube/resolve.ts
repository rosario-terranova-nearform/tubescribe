// Resolve a parsed source input (from @tubescribe/shared's parseSourceInput)
// into a canonical ResolvedSource: title, thumbnail and video count for the
// confirmation card. Channel handles are normalized to their UC id so the
// same channel pasted in different forms dedupes in the sources table.

import type { SourceInput } from '@tubescribe/shared';
import type { InnertubeLike, ResolvedSource, ThumbnailLike } from './types.js';

/** Pick the largest thumbnail; protocol-relative URLs get an https: prefix. */
export function bestThumbnailUrl(thumbnails: readonly ThumbnailLike[] | undefined): string | null {
  if (!thumbnails || thumbnails.length === 0) return null;
  const best = thumbnails.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  if (!best.url) return null;
  return best.url.startsWith('//') ? `https:${best.url}` : best.url;
}

export async function resolveSource(
  client: InnertubeLike,
  input: SourceInput,
): Promise<ResolvedSource> {
  switch (input.kind) {
    case 'channel':
      return resolveChannel(client, input.identifier);
    case 'playlist':
      return resolvePlaylist(client, input.identifier);
    case 'video':
      return resolveVideo(client, input.identifier);
  }
}

async function resolveChannel(client: InnertubeLike, identifier: string): Promise<ResolvedSource> {
  const channelId = await resolveChannelId(client, identifier);
  const channel = await client.getChannel(channelId);
  const title = channel.metadata?.title;
  if (!title) {
    throw new Error(`could not resolve channel title for ${identifier}`);
  }
  // Channels don't expose a cheap total; videoCount stays undefined.
  return {
    kind: 'channel',
    identifier: channelId,
    title,
    thumbnailUrl: bestThumbnailUrl(channel.metadata?.avatar),
  };
}

/**
 * Normalize a channel identifier to its UC id. parseSourceInput guarantees
 * the identifier is either `@handle` or a `UC…` id, so a startsWith check
 * is sufficient — anything that is not a handle is already canonical.
 */
async function resolveChannelId(client: InnertubeLike, identifier: string): Promise<string> {
  if (!identifier.startsWith('@')) return identifier;
  const endpoint = await client.resolveURL(`https://www.youtube.com/${identifier}`);
  const browseId = endpoint.payload?.browseId;
  if (typeof browseId !== 'string' || browseId.length === 0) {
    throw new Error(`could not resolve channel handle ${identifier} to a channel id`);
  }
  return browseId;
}

async function resolvePlaylist(client: InnertubeLike, identifier: string): Promise<ResolvedSource> {
  const playlist = await client.getPlaylist(identifier);
  const title = playlist.info.title;
  if (!title) {
    throw new Error(`could not resolve playlist title for ${identifier}`);
  }
  return {
    kind: 'playlist',
    identifier,
    title,
    thumbnailUrl: bestThumbnailUrl(playlist.info.thumbnails),
    videoCount: parseItemCount(playlist.info.total_items),
  };
}

async function resolveVideo(client: InnertubeLike, identifier: string): Promise<ResolvedSource> {
  const info = await client.getBasicInfo(identifier);
  const title = info.basic_info.title;
  if (!title) {
    throw new Error(`could not resolve video title for ${identifier}`);
  }
  return {
    kind: 'video',
    identifier,
    title,
    thumbnailUrl: bestThumbnailUrl(info.basic_info.thumbnail),
    videoCount: 1,
  };
}

/** total_items is a rendered string ("42", "1,234"); tolerate separators. */
function parseItemCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 0) return undefined;
  const n = Number.parseInt(digits, 10);
  return Number.isNaN(n) ? undefined : n;
}
