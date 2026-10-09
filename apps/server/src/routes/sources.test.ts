// Integration tests for /api/sources/* with a fixture-backed fake youtube
// client and a real extraction worker running fake engines — no network.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApiErrorSchema,
  CreateSourceResponseSchema,
  GetJobResponseSchema,
  GetSourceResponseSchema,
  type Job,
  ListSourceVideosResponseSchema,
  ListSourcesResponseSchema,
  ReextractSourceResponseSchema,
  ResolveSourceResponseSchema,
  type Video,
} from '@tubescribe/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { jobItems, jobs, sources, videos } from '../db/schema.js';
import { transcriptPaths } from '../jobs/files.js';
import { type ExtractionWorker, createExtractionWorker } from '../jobs/worker.js';
import { createLogger } from '../logger.js';
import { alwaysOk, fakeEngine, okResult, unavailable } from '../testing/fake-engines.js';
import { type TestDb, makeTestDb } from '../testing/test-db.js';
import { fakeChannel, fakeInnertube } from '../youtube/__fixtures__/fakes.js';
import type { TranscriptEngine } from '../youtube/engines/engine.js';
import type { InnertubeLike } from '../youtube/types.js';

const CHANNEL_ID = `UC${'a'.repeat(22)}`;
const VIDEO_1 = 'vid-0000001';
const VIDEO_2 = 'vid-0000002';

function channelClient(): InnertubeLike {
  return fakeInnertube({
    resolveURL: { 'https://www.youtube.com/@testhandle': CHANNEL_ID },
    channels: {
      [CHANNEL_ID]: fakeChannel({
        metadata: {
          title: 'Test Channel',
          avatar: [{ url: 'https://yt.example/avatar.jpg', width: 800, height: 800 }],
        },
        tabs: {
          videos: {
            pages: [
              {
                hasContinuation: false,
                videos: [
                  {
                    video_id: VIDEO_1,
                    title: 'First video',
                    published: 'Mar 5, 2023',
                    duration: { seconds: 60 },
                  },
                  {
                    video_id: VIDEO_2,
                    title: 'Second video',
                    published: 'Mar 6, 2023',
                    duration: { seconds: 120 },
                  },
                ],
              },
            ],
          },
        },
      }),
    },
  });
}

interface Setup extends TestDb {
  app: Express;
  worker: ExtractionWorker;
  cleanup: () => Promise<void>;
}

function setup(
  opts: { client?: InnertubeLike; engines?: TranscriptEngine[]; startWorker?: boolean } = {},
): Setup {
  const base = makeTestDb();
  const worker = createExtractionWorker({
    db: base.db,
    config: base.config,
    logger: createLogger(base.config),
    engines: opts.engines ?? [alwaysOk('youtubei.js')],
    sleep: () => Promise.resolve(),
    idlePollMs: 5,
  });
  const app = createApp({
    config: base.config,
    db: base.db,
    youtube: () => Promise.resolve(opts.client ?? fakeInnertube({})),
    worker,
  });
  if (opts.startWorker !== false) worker.start();
  return {
    ...base,
    app,
    worker,
    cleanup: async () => {
      await worker.stop();
      base.cleanup();
    },
  };
}

async function waitForJob(app: Express, jobId: string): Promise<Job> {
  let job: Job | undefined;
  await vi.waitFor(
    async () => {
      const res = await request(app).get(`/api/jobs/${jobId}`);
      expect(res.status).toBe(200);
      job = GetJobResponseSchema.parse(res.body).job;
      expect(['completed', 'failed', 'cancelled']).toContain(job.status);
    },
    { timeout: 5000, interval: 10 },
  );
  if (!job) throw new Error(`job ${jobId} never appeared`);
  return job;
}

async function createSource(app: Express, identifier = CHANNEL_ID) {
  const res = await request(app).post('/api/sources').send({ kind: 'channel', identifier });
  expect(res.status).toBe(201);
  return CreateSourceResponseSchema.parse(res.body);
}

function byId(list: Video[]): Record<string, Video> {
  return Object.fromEntries(list.map((v) => [v.id, v]));
}

/** Index lookup that fails loudly instead of returning undefined. */
function must(video: Video | undefined): Video {
  if (!video) throw new Error('expected video in list response');
  return video;
}

describe('/api/sources', () => {
  let t: Setup;
  afterEach(async () => {
    await t?.cleanup();
  });

  it('resolve → create → job enqueued → videos listed after fake extraction', async () => {
    t = setup({ client: channelClient() });

    // 1. Resolve a pasted URL into a confirmation-card suggestion.
    const resolve = await request(t.app)
      .post('/api/sources/resolve')
      .send({ input: `https://www.youtube.com/channel/${CHANNEL_ID}` });
    expect(resolve.status).toBe(200);
    const { suggestion } = ResolveSourceResponseSchema.parse(resolve.body);
    expect(suggestion).toEqual({
      kind: 'channel',
      identifier: CHANNEL_ID,
      title: 'Test Channel',
      thumbnailUrl: 'https://yt.example/avatar.jpg',
      channelTitle: null,
      videoCount: null,
      duplicate: false,
    });

    // 2. Create → source row + extraction job enqueued.
    const create = await request(t.app)
      .post('/api/sources')
      .send({ kind: suggestion.kind, identifier: suggestion.identifier });
    expect(create.status).toBe(201);
    const { source, job } = CreateSourceResponseSchema.parse(create.body);
    expect(source).toMatchObject({
      kind: 'channel',
      identifier: CHANNEL_ID,
      title: 'Test Channel',
      videoCount: null,
    });
    expect(job).toMatchObject({
      kind: 'extract',
      sourceId: source.id,
      status: 'queued',
      totalItems: 2,
      processedItems: 0,
      failedItems: 0,
    });

    // 3. The wired worker drains the job with the fake engine.
    const done = await waitForJob(t.app, job.id);
    expect(done).toMatchObject({ status: 'completed', processedItems: 2, failedItems: 0 });

    // 4. Videos are listed with extraction results.
    const videosRes = await request(t.app).get(`/api/sources/${source.id}/videos`);
    expect(videosRes.status).toBe(200);
    const list = ListSourceVideosResponseSchema.parse(videosRes.body);
    expect(list).toMatchObject({ total: 2, limit: 100, offset: 0 });
    expect(list.videos.map((v) => v.id)).toEqual([VIDEO_1, VIDEO_2]);
    for (const v of list.videos) {
      expect(v).toMatchObject({
        sourceId: source.id,
        status: 'fetched',
        language: 'en',
        captionKind: 'manual',
        engine: 'youtubei.js',
        error: null,
      });
    }

    // 5. List + detail expose the aggregated status.
    const listed = ListSourcesResponseSchema.parse((await request(t.app).get('/api/sources')).body);
    expect(listed.sources).toHaveLength(1);
    expect(listed.sources[0]).toMatchObject({
      id: source.id,
      status: { total: 2, pending: 0, fetched: 2, failed: 0, embedded: 0 },
    });
    const detail = await request(t.app).get(`/api/sources/${source.id}`);
    expect(GetSourceResponseSchema.parse(detail.body).source).toEqual(listed.sources[0]);

    // 6. Transcript files landed on disk.
    for (const videoId of [VIDEO_1, VIDEO_2]) {
      const { jsonPath, mdPath } = transcriptPaths(t.dataDir, source.id, videoId);
      expect(existsSync(jsonPath), `${videoId}.json`).toBe(true);
      expect(existsSync(mdPath), `${videoId}.md`).toBe(true);
    }
  });

  it('create normalizes @handle to the UC id; duplicate creates return 409 either spelling', async () => {
    t = setup({ client: channelClient() });

    const { source } = await createSource(t.app, '@testhandle');
    expect(source.identifier).toBe(CHANNEL_ID);

    // Resolving an already-added source flags the duplicate instead of failing.
    const resolve = await request(t.app)
      .post('/api/sources/resolve')
      .send({ input: '@testhandle' });
    expect(resolve.status).toBe(200);
    expect(ResolveSourceResponseSchema.parse(resolve.body).suggestion.duplicate).toBe(true);

    for (const identifier of [CHANNEL_ID, '@testhandle']) {
      const res = await request(t.app).post('/api/sources').send({ kind: 'channel', identifier });
      expect(res.status).toBe(409);
      const { error } = ApiErrorSchema.parse(res.body);
      expect(error.code).toBe('CONFLICT');
      expect(error.details?.field).toBe('identifier');
    }
  });

  it('invalid bodies and unparseable input return 400 VALIDATION', async () => {
    t = setup();

    for (const body of [
      {},
      { kind: 'video' },
      { kind: 'nope', identifier: 'vid-0000001' },
      { kind: 'video', identifier: 'vid-0000001', typeFilter: { uploads: true } },
      { kind: 'video', identifier: 'vid-0000001', bogus: 1 },
    ]) {
      const res = await request(t.app).post('/api/sources').send(body);
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION');
    }

    for (const body of [{}, { input: '' }, { input: 42 }]) {
      const res = await request(t.app).post('/api/sources/resolve').send(body);
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION');
    }

    const garbage = await request(t.app)
      .post('/api/sources/resolve')
      .send({ input: '??? not a source !!!' });
    expect(garbage.status).toBe(400);
    const { error } = ApiErrorSchema.parse(garbage.body);
    expect(error.code).toBe('VALIDATION');
    expect(error.details?.field).toBe('input');
  });

  it('unresolvable sources return 422 UNPROCESSABLE and create persists nothing', async () => {
    t = setup(); // fake client with no fixtures → every lookup throws

    const resolve = await request(t.app)
      .post('/api/sources/resolve')
      .send({ input: 'ZZZZZZZZZZZ' });
    expect(resolve.status).toBe(422);
    expect(ApiErrorSchema.parse(resolve.body).error.code).toBe('UNPROCESSABLE');

    const create = await request(t.app)
      .post('/api/sources')
      .send({ kind: 'video', identifier: 'ZZZZZZZZZZZ' });
    expect(create.status).toBe(422);
    expect(ApiErrorSchema.parse(create.body).error.code).toBe('UNPROCESSABLE');

    const listed = await request(t.app).get('/api/sources');
    expect(ListSourcesResponseSchema.parse(listed.body).sources).toEqual([]);
  });

  it('missing sources return 404 NOT_FOUND', async () => {
    t = setup();

    const expected404 = [
      await request(t.app).get('/api/sources/nope'),
      await request(t.app).get('/api/sources/nope/videos'),
      await request(t.app).post('/api/sources/nope/reextract'),
      await request(t.app).delete('/api/sources/nope'),
    ];
    for (const res of expected404) {
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
    }
  });

  it('paginates source videos with limit/offset and a total', async () => {
    t = setup({ client: channelClient() });
    const { source } = await createSource(t.app);

    const page1 = ListSourceVideosResponseSchema.parse(
      (await request(t.app).get(`/api/sources/${source.id}/videos?limit=1`)).body,
    );
    expect(page1).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(page1.videos.map((v) => v.id)).toEqual([VIDEO_1]);

    const page2 = ListSourceVideosResponseSchema.parse(
      (await request(t.app).get(`/api/sources/${source.id}/videos?limit=1&offset=1`)).body,
    );
    expect(page2).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(page2.videos.map((v) => v.id)).toEqual([VIDEO_2]);

    const pastEnd = ListSourceVideosResponseSchema.parse(
      (await request(t.app).get(`/api/sources/${source.id}/videos?offset=5`)).body,
    );
    expect(pastEnd).toMatchObject({ total: 2, videos: [] });

    const badQuery = await request(t.app).get(`/api/sources/${source.id}/videos?limit=0`);
    expect(badQuery.status).toBe(400);
    expect(ApiErrorSchema.parse(badQuery.body).error.code).toBe('VALIDATION');
  });

  it('re-extract re-enqueues failed videos; ?all=true re-enqueues everything', async () => {
    // VIDEO_2 fails once (→ failed), then succeeds on later attempts.
    const engine = fakeEngine('youtubei.js', (videoId, callCount) => {
      if (videoId === VIDEO_2 && callCount === 1) throw unavailable(videoId);
      return okResult('youtubei.js');
    });
    t = setup({ client: channelClient(), engines: [engine] });
    const { source, job } = await createSource(t.app);
    await waitForJob(t.app, job.id);

    const before = byId(
      ListSourceVideosResponseSchema.parse(
        (await request(t.app).get(`/api/sources/${source.id}/videos`)).body,
      ).videos,
    );
    expect(must(before[VIDEO_1]).status).toBe('fetched');
    expect(must(before[VIDEO_2])).toMatchObject({ status: 'failed' });
    expect(must(before[VIDEO_2]).error).toContain('unavailable');

    // Default: failed items only.
    const re = await request(t.app).post(`/api/sources/${source.id}/reextract`);
    expect(re.status).toBe(201);
    const { job: reJob } = ReextractSourceResponseSchema.parse(re.body);
    expect(reJob).toMatchObject({ kind: 'extract', sourceId: source.id, totalItems: 1 });
    await waitForJob(t.app, reJob.id);

    const after = byId(
      ListSourceVideosResponseSchema.parse(
        (await request(t.app).get(`/api/sources/${source.id}/videos`)).body,
      ).videos,
    );
    expect(after[VIDEO_2]).toMatchObject({ status: 'fetched', error: null, engine: 'youtubei.js' });

    // ?all=true re-enqueues every video of the source.
    const reAll = await request(t.app).post(`/api/sources/${source.id}/reextract?all=true`);
    expect(reAll.status).toBe(201);
    const { job: allJob } = ReextractSourceResponseSchema.parse(reAll.body);
    expect(allJob.totalItems).toBe(2);
    await waitForJob(t.app, allJob.id);

    expect(engine.calls.filter((v) => v === VIDEO_1)).toHaveLength(2);
    expect(engine.calls.filter((v) => v === VIDEO_2)).toHaveLength(3);

    const detail = GetSourceResponseSchema.parse(
      (await request(t.app).get(`/api/sources/${source.id}`)).body,
    );
    expect(detail.source.status).toEqual({
      total: 2,
      pending: 0,
      fetched: 2,
      failed: 0,
      embedded: 0,
    });

    // Nothing failed → re-extract enqueues an empty job.
    const none = await request(t.app).post(`/api/sources/${source.id}/reextract`);
    expect(none.status).toBe(201);
    expect(ReextractSourceResponseSchema.parse(none.body).job.totalItems).toBe(0);
  });

  it('delete removes the row, its videos/jobs, and its transcript files', async () => {
    t = setup({ client: channelClient() });
    const { source, job } = await createSource(t.app);
    await waitForJob(t.app, job.id);
    const dir = join(t.dataDir, 'transcripts', source.id);
    expect(existsSync(join(dir, `${VIDEO_1}.json`))).toBe(true);

    const res = await request(t.app).delete(`/api/sources/${source.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect((await request(t.app).get(`/api/sources/${source.id}`)).status).toBe(404);
    expect(existsSync(dir)).toBe(false);
    // FK cascades removed the dependent rows.
    expect(t.db.select().from(videos).all()).toEqual([]);
    expect(t.db.select().from(jobs).all()).toEqual([]);
    expect(t.db.select().from(jobItems).all()).toEqual([]);
  });

  it('delete of a source with no files on disk still succeeds', async () => {
    // No worker → nothing is extracted, no transcript dir is ever written.
    t = setup({ client: channelClient(), startWorker: false });
    const { source } = await createSource(t.app);
    expect(existsSync(join(t.dataDir, 'transcripts', source.id))).toBe(false);

    const res = await request(t.app).delete(`/api/sources/${source.id}`);
    expect(res.status).toBe(200);
    expect(existsSync(join(t.dataDir, 'transcripts', source.id))).toBe(false);
    expect(t.db.select().from(sources).all()).toEqual([]);
  });
});
