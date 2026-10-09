// Integration tests for /api/jobs/* — jobs are seeded directly via the queue
// (no worker needed); progress counts come from real item transitions.

import { ApiErrorSchema, GetJobResponseSchema, ListJobsResponseSchema } from '@tubescribe/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema.js';
import {
  claimNextPendingItem,
  completeDrainedJobs,
  createJob,
  markItemFailed,
  markItemSucceeded,
} from '../jobs/queue.js';
import { type TestApp, makeTestApp } from '../testing/test-app.js';
import { seedSource } from '../testing/test-db.js';
import type { DiscoveredVideo } from '../youtube/types.js';

const discovered = (videoId: string): DiscoveredVideo => ({
  videoId,
  title: `Title ${videoId}`,
  publishedAt: '2023-03-05T00:00:00.000Z',
  durationS: 60,
});

describe('/api/jobs', () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  function setStartedAt(jobId: string, startedAt: string): void {
    t.db.update(jobs).set({ startedAt }).where(eq(jobs.id, jobId)).run();
  }

  it('lists active jobs first, then recent finished ones, with progress counts', async () => {
    t = makeTestApp();
    const sourceId = seedSource(t.db);

    // A finished job with mixed item outcomes (progress counters moved).
    const done = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid0000000a', 'vid0000000b'].map(discovered),
    });
    const first = claimNextPendingItem(t.db);
    if (!first) throw new Error('expected item');
    markItemSucceeded(t.db, first.item.id);
    const second = claimNextPendingItem(t.db);
    if (!second) throw new Error('expected item');
    markItemFailed(t.db, second.item.id, 'boom');
    completeDrainedJobs(t.db);

    // An older finished job (zero items drain immediately) + a fresh active one.
    const olderDone = createJob(t.db, { kind: 'extract', sourceId, videos: [] });
    completeDrainedJobs(t.db);
    const active = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid0000000d', 'vid0000000e', 'vid0000000f'].map(discovered),
    });
    // Deterministic ordering independent of wall-clock ties.
    setStartedAt(done.id, '2026-01-02T00:00:00.000Z');
    setStartedAt(olderDone.id, '2026-01-01T00:00:00.000Z');
    setStartedAt(active.id, '2026-01-03T00:00:00.000Z');

    const res = await request(t.app).get('/api/jobs');
    expect(res.status).toBe(200);
    const { jobs: listed } = ListJobsResponseSchema.parse(res.body);

    expect(listed.map((j) => j.id)).toEqual([active.id, done.id, olderDone.id]);
    expect(listed[0]).toMatchObject({ status: 'queued', totalItems: 3, processedItems: 0 });
    expect(listed[1]).toMatchObject({
      status: 'completed',
      totalItems: 2,
      processedItems: 2,
      failedItems: 1,
    });
  });

  it('filters by status, kind, and sourceId', async () => {
    t = makeTestApp();
    const sourceA = seedSource(t.db, { id: 'source-a' });
    const sourceB = seedSource(t.db, { id: 'source-b' });
    const jobA = createJob(t.db, { kind: 'extract', sourceId: sourceA, videos: [] });
    const jobB = createJob(t.db, {
      kind: 'extract',
      sourceId: sourceB,
      videos: [discovered('vid00000001')],
    });
    completeDrainedJobs(t.db); // jobA (zero items) completes; jobB stays queued

    const bySource = ListJobsResponseSchema.parse(
      (await request(t.app).get(`/api/jobs?sourceId=${sourceB}`)).body,
    ).jobs;
    expect(bySource.map((j) => j.id)).toEqual([jobB.id]);

    const completed = ListJobsResponseSchema.parse(
      (await request(t.app).get('/api/jobs?status=completed')).body,
    ).jobs;
    expect(completed.map((j) => j.id)).toEqual([jobA.id]);

    const running = ListJobsResponseSchema.parse(
      (await request(t.app).get('/api/jobs?status=running')).body,
    ).jobs;
    expect(running).toEqual([]);

    const extracts = ListJobsResponseSchema.parse(
      (await request(t.app).get('/api/jobs?kind=extract')).body,
    ).jobs;
    expect(extracts.map((j) => j.id).sort()).toEqual([jobA.id, jobB.id].sort());

    const bad = await request(t.app).get('/api/jobs?status=nope');
    expect(bad.status).toBe(400);
    expect(ApiErrorSchema.parse(bad.body).error.code).toBe('VALIDATION');
  });

  it('GET /api/jobs/:id returns the job with its items in discovery order', async () => {
    t = makeTestApp();
    const sourceId = seedSource(t.db);
    const job = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid0000000a', 'vid0000000b'].map(discovered),
    });

    const res = await request(t.app).get(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    const parsed = GetJobResponseSchema.parse(res.body);
    expect(parsed.job).toMatchObject({ id: job.id, totalItems: 2, status: 'queued' });
    expect(parsed.items?.map((i) => i.videoId)).toEqual(['vid0000000a', 'vid0000000b']);
    for (const item of parsed.items ?? []) {
      expect(item).toMatchObject({ jobId: job.id, status: 'pending', error: null });
    }
  });

  it('GET /api/jobs/:id returns 404 NOT_FOUND for unknown jobs', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/api/jobs/nope');

    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });
});
