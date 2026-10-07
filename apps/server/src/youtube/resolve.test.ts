import { describe, expect, it } from 'vitest';
import { fakeChannel, fakeInnertube, fakePlaylist } from './__fixtures__/fakes.js';
import channelHandleFixture from './__fixtures__/resolve-channel-handle.json' with { type: 'json' };
import channelIdFixture from './__fixtures__/resolve-channel-id.json' with { type: 'json' };
import playlistFixture from './__fixtures__/resolve-playlist.json' with { type: 'json' };
import videoFixture from './__fixtures__/resolve-video.json' with { type: 'json' };
import { bestThumbnailUrl, resolveSource } from './resolve.js';
import type { VideoInfoLike } from './types.js';

function videoInfoFromBasicInfo(fixture: typeof videoFixture): VideoInfoLike {
  return {
    basic_info: fixture.basic_info,
    getTranscript: () => Promise.reject(new Error('not used by resolve')),
  };
}

describe('resolveSource', () => {
  it('resolves a channel @handle to its canonical UC id', async () => {
    const client = fakeInnertube({
      resolveURL: { 'https://www.youtube.com/@ExampleCreator': channelHandleFixture.browseId },
      channels: {
        [channelHandleFixture.browseId]: fakeChannel({
          metadata: channelHandleFixture.metadata,
        }),
      },
    });

    const resolved = await resolveSource(client, {
      kind: 'channel',
      identifier: channelHandleFixture.handle,
    });

    expect(resolved).toEqual({
      kind: 'channel',
      identifier: 'UCexamplechannel12345678',
      title: 'Example Creator',
      // Largest avatar, protocol-relative URL prefixed with https:.
      thumbnailUrl: 'https://yt3.googleusercontent.com/example-big',
    });
    expect(client.log.calls.map((c) => c.method)).toEqual(['resolveURL', 'getChannel']);
  });

  it('resolves a channel given as UC id without calling resolveURL', async () => {
    const client = fakeInnertube({
      channels: {
        [channelIdFixture.channelId]: fakeChannel({ metadata: channelIdFixture.metadata }),
      },
    });

    const resolved = await resolveSource(client, {
      kind: 'channel',
      identifier: channelIdFixture.channelId,
    });

    expect(resolved).toEqual({
      kind: 'channel',
      identifier: 'UCdirectchannel12345678',
      title: 'Direct Channel',
      thumbnailUrl: 'https://yt3.googleusercontent.com/direct',
    });
    expect(client.log.calls.map((c) => c.method)).toEqual(['getChannel']);
  });

  it('resolves a playlist with a parsed video count', async () => {
    const client = fakeInnertube({
      playlists: { [playlistFixture.playlistId]: fakePlaylist({ info: playlistFixture.info }) },
    });

    const resolved = await resolveSource(client, {
      kind: 'playlist',
      identifier: playlistFixture.playlistId,
    });

    expect(resolved).toEqual({
      kind: 'playlist',
      identifier: 'PLexampleplaylist1234',
      title: 'Example Playlist',
      thumbnailUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      videoCount: 1234, // "1,234" with the separator stripped
    });
  });

  it('resolves a single video', async () => {
    const client = fakeInnertube({
      videoInfos: { [videoFixture.videoId]: videoInfoFromBasicInfo(videoFixture) },
    });

    const resolved = await resolveSource(client, {
      kind: 'video',
      identifier: videoFixture.videoId,
    });

    expect(resolved).toEqual({
      kind: 'video',
      identifier: 'dQw4w9WgXcQ',
      title: 'A Single Video',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      videoCount: 1,
    });
    expect(client.log.calls.map((c) => c.method)).toEqual(['getBasicInfo']);
  });
});

describe('bestThumbnailUrl', () => {
  it('returns null for missing or empty thumbnail lists', () => {
    expect(bestThumbnailUrl(undefined)).toBeNull();
    expect(bestThumbnailUrl([])).toBeNull();
  });
});
