import { DEFAULT_TYPE_FILTER, type SourceTypeFilter } from '@tubescribe/shared';
import { describe, expect, it } from 'vitest';
import {
  type CallLog,
  fakeChannel,
  fakeInnertube,
  fakePlaylist,
  newCallLog,
} from './__fixtures__/fakes.js';
import channelFixture from './__fixtures__/list-channel.json' with { type: 'json' };
import playlistFixture from './__fixtures__/list-playlist.json' with { type: 'json' };
import { type ListableSource, listSourceVideos } from './list.js';
import type { DiscoveredVideo, InnertubeLike } from './types.js';

const CHANNEL_ID = 'UCexamplechannel12345678';

async function collect(
  client: InnertubeLike,
  source: ListableSource,
  filter: SourceTypeFilter = DEFAULT_TYPE_FILTER,
): Promise<DiscoveredVideo[]> {
  const out: DiscoveredVideo[] = [];
  for await (const video of listSourceVideos(client, source, filter)) {
    out.push(video);
  }
  return out;
}

function channelClient(log: CallLog) {
  const channel = fakeChannel(channelFixture, log);
  return fakeInnertube({ channels: { [CHANNEL_ID]: channel } }, log);
}

describe('listSourceVideos — channel', () => {
  it('lists the uploads tab across continuations', async () => {
    const log = newCallLog();
    const client = channelClient(log);

    const videos = await collect(client, { kind: 'channel', identifier: CHANNEL_ID });

    expect(videos.map((v) => v.videoId)).toEqual(['vid00000001', 'vid00000002', 'vid00000003']);
    expect(videos[0]).toEqual({
      videoId: 'vid00000001',
      title: 'First upload',
      publishedAt: '2023-03-05T00:00:00.000Z', // "Mar 5, 2023" as a calendar date
      durationS: 754,
    });
    // Relative dates can't be anchored to a calendar date → null.
    expect(videos[1]?.publishedAt).toBeNull();
    // Grid layout nodes carry duration as text — "1:02:03" parses to seconds.
    expect(videos[1]?.durationS).toBe(3723);
    // Followed exactly one continuation, then stopped.
    expect(log.calls.filter((c) => c.method === 'getContinuation')).toHaveLength(1);
  });

  it('maps the type filter onto channel tabs and dedupes across tabs', async () => {
    const log = newCallLog();
    const client = channelClient(log);

    const videos = await collect(
      client,
      { kind: 'channel', identifier: CHANNEL_ID },
      {
        uploads: true,
        shorts: true,
        live: true,
      },
    );

    // vid00000003 appears in both uploads and live — listed once.
    expect(videos.map((v) => v.videoId)).toEqual([
      'vid00000001',
      'vid00000002',
      'vid00000003',
      'sht00000001',
      'sht00000002',
      'sht00000003',
      'liv00000001',
    ]);
    const tabCalls = log.calls.map((c) => c.method);
    expect(tabCalls).toContain('channel.videos');
    expect(tabCalls).toContain('channel.shorts');
    expect(tabCalls).toContain('channel.live');
  });

  it('only touches the tabs enabled by the type filter', async () => {
    const log = newCallLog();
    const client = channelClient(log);

    const videos = await collect(
      client,
      { kind: 'channel', identifier: CHANNEL_ID },
      {
        uploads: false,
        shorts: true,
        live: false,
      },
    );

    expect(log.calls.map((c) => c.method)).toEqual(['getChannel', 'channel.shorts']);
    expect(videos.map((v) => v.videoId)).toEqual(['sht00000001', 'sht00000002', 'sht00000003']);
  });

  it('normalizes shorts nodes (entity_id / on_tap_endpoint / reel) with no date or duration', async () => {
    const log = newCallLog();
    const client = channelClient(log);

    const videos = await collect(
      client,
      { kind: 'channel', identifier: CHANNEL_ID },
      {
        uploads: false,
        shorts: true,
        live: false,
      },
    );

    expect(videos[0]).toEqual({
      videoId: 'sht00000001', // extracted from the shorts-shelf-item entity id
      title: 'A short',
      publishedAt: null,
      durationS: 0,
    });
    expect(videos[1]?.videoId).toBe('sht00000002'); // from on_tap_endpoint payload
    expect(videos[2]?.videoId).toBe('sht00000003'); // legacy reel node
  });

  it('skips non-video lockup nodes', async () => {
    const log = newCallLog();
    const client = channelClient(log);

    const videos = await collect(
      client,
      { kind: 'channel', identifier: CHANNEL_ID },
      {
        uploads: false,
        shorts: false,
        live: true,
      },
    );

    // The PLAYLIST lockup in the live tab fixture is dropped.
    expect(videos.map((v) => v.videoId)).toEqual(['vid00000003', 'liv00000001']);
  });
});

describe('listSourceVideos — playlist', () => {
  it('lists items across continuations', async () => {
    const log = newCallLog();
    const playlist = fakePlaylist(playlistFixture, log);
    const client = fakeInnertube({ playlists: { PLexampleplaylist1234: playlist } }, log);

    const videos = await collect(client, { kind: 'playlist', identifier: 'PLexampleplaylist1234' });

    expect(videos.map((v) => v.videoId)).toEqual(['plv00000001', 'plv00000002', 'plv00000003']);
    expect(videos[0]).toEqual({
      videoId: 'plv00000001',
      title: 'Playlist video',
      publishedAt: null,
      durationS: 120,
    });
    expect(log.calls.filter((c) => c.method === 'getContinuation')).toHaveLength(1);
  });
});

describe('listSourceVideos — video', () => {
  it('yields exactly the one video', async () => {
    const log = newCallLog();
    const client = fakeInnertube(
      {
        videoInfos: {
          dQw4w9WgXcQ: {
            basic_info: { id: 'dQw4w9WgXcQ', title: 'A Single Video', duration: 212 },
            getTranscript: () => Promise.reject(new Error('not used by list')),
          },
        },
      },
      log,
    );

    const videos = await collect(client, { kind: 'video', identifier: 'dQw4w9WgXcQ' });

    expect(videos).toEqual([
      { videoId: 'dQw4w9WgXcQ', title: 'A Single Video', publishedAt: null, durationS: 212 },
    ]);
    expect(log.calls.map((c) => c.method)).toEqual(['getBasicInfo']);
  });
});
