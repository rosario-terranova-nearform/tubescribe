import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { videos } from '../db/schema.js';
import { type TestDb, makeTestDb, seedSource } from '../testing/test-db.js';
import { claimNextPendingItem, createJob, markItemFailed, markItemSucceeded } from './queue.js';
import { getJobStatus, getSourceStatus } from './status.js';

describe('status', () => {
  let t: TestDb;
  let sourceId: string;

  beforeEach(() => {
    t = makeTestDb();
    sourceId = seedSource(t.db);
  });

  afterEach(() => {
    t.cleanup();
  });

  it('aggregates per-source video counts (pending / fetched / failed)', () => {
    createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: [
        { videoId: 'vid00000001', title: 'v1', publishedAt: null, durationS: 1 },
        { videoId: 'vid00000002', title: 'v2', publishedAt: null, durationS: 1 },
        { videoId: 'vid00000003', title: 'v3', publishedAt: null, durationS: 1 },
        { videoId: 'vid00000004', title: 'v4', publishedAt: null, durationS: 1 },
      ],
    });
    t.db.update(videos).set({ status: 'fetched' }).where(eq(videos.id, 'vid00000001')).run();
    t.db.update(videos).set({ status: 'failed' }).where(eq(videos.id, 'vid00000002')).run();
    t.db.update(videos).set({ status: 'embedded' }).where(eq(videos.id, 'vid00000003')).run();

    expect(getSourceStatus(t.db, sourceId)).toEqual({
      sourceId,
      total: 4,
      pending: 1,
      fetched: 1,
      failed: 1,
      embedded: 1,
    });
  });

  it('returns zeros for a source with no videos', () => {
    expect(getSourceStatus(t.db, sourceId)).toEqual({
      sourceId,
      total: 0,
      pending: 0,
      fetched: 0,
      failed: 0,
      embedded: 0,
    });
  });

  it('aggregates per-job item counts (pending / running / succeeded / failed)', () => {
    const job = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: [
        { videoId: 'vid00000001', title: 'v1', publishedAt: null, durationS: 1 },
        { videoId: 'vid00000002', title: 'v2', publishedAt: null, durationS: 1 },
        { videoId: 'vid00000003', title: 'v3', publishedAt: null, durationS: 1 },
        { videoId: 'vid00000004', title: 'v4', publishedAt: null, durationS: 1 },
        { videoId: 'vid00000005', title: 'v5', publishedAt: null, durationS: 1 },
      ],
    });

    const claim = () => {
      const claimed = claimNextPendingItem(t.db);
      if (!claimed) throw new Error('expected a claimable item');
      return claimed.item;
    };
    markItemSucceeded(t.db, claim().id);
    markItemSucceeded(t.db, claim().id);
    markItemFailed(t.db, claim().id, 'boom');
    claim(); // leaves one item running, one pending

    expect(getJobStatus(t.db, job.id)).toEqual({
      jobId: job.id,
      total: 5,
      pending: 1,
      running: 1,
      succeeded: 2,
      failed: 1,
    });
  });

  it('returns zeros for a zero-item job', () => {
    const job = createJob(t.db, { kind: 'extract', sourceId, videos: [] });

    expect(getJobStatus(t.db, job.id)).toEqual({
      jobId: job.id,
      total: 0,
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    });
  });
});
