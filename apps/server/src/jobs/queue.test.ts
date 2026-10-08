import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobItems, jobs, videos } from '../db/schema.js';
import { type TestDb, makeTestDb, seedSource } from '../testing/test-db.js';
import type { DiscoveredVideo } from '../youtube/types.js';
import {
  claimNextPendingItem,
  completeDrainedJobs,
  createJob,
  markItemFailed,
  markItemSucceeded,
  resetRunningItems,
} from './queue.js';

function discovered(videoId: string, title = `Video ${videoId}`): DiscoveredVideo {
  return { videoId, title, publishedAt: '2023-03-05T00:00:00.000Z', durationS: 60 };
}

function getItem(db: TestDb['db'], itemId: string) {
  return db.select().from(jobItems).where(eq(jobItems.id, itemId)).get();
}

function getJob(db: TestDb['db'], jobId: string) {
  return db.select().from(jobs).where(eq(jobs.id, jobId)).get();
}

describe('queue', () => {
  let t: TestDb;
  let sourceId: string;

  beforeEach(() => {
    t = makeTestDb();
    sourceId = seedSource(t.db);
  });

  afterEach(() => {
    t.cleanup();
  });

  describe('createJob', () => {
    it('creates a queued job with one pending item and one video row per discovered video', () => {
      const job = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001'), discovered('vid00000002')],
      });

      expect(job.status).toBe('queued');
      expect(job.totalItems).toBe(2);
      expect(job.processedItems).toBe(0);
      expect(job.failedItems).toBe(0);

      const items = t.db.select().from(jobItems).where(eq(jobItems.jobId, job.id)).all();
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.status)).toEqual(['pending', 'pending']);

      const videoRows = t.db.select().from(videos).where(eq(videos.sourceId, sourceId)).all();
      expect(videoRows).toHaveLength(2);
      const v1 = videoRows.find((v) => v.id === 'vid00000001');
      expect(v1).toMatchObject({
        title: 'Video vid00000001',
        url: 'https://www.youtube.com/watch?v=vid00000001',
        status: 'pending',
        language: '',
        engine: null,
      });
    });

    it('handles zero videos', () => {
      const job = createJob(t.db, { kind: 'extract', sourceId, videos: [] });
      expect(job.totalItems).toBe(0);
      expect(t.db.select().from(jobItems).all()).toHaveLength(0);
    });

    it('refreshes discovery metadata on re-extract but keeps corpus fields', () => {
      const first = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001')],
      });
      expect(first.totalItems).toBe(1);
      // Simulate a completed fetch.
      t.db
        .update(videos)
        .set({
          status: 'fetched',
          language: 'en',
          captionKind: 'manual',
          engine: 'youtubei.js',
          fetchedAt: '2026-10-08T09:00:00.000Z',
        })
        .where(eq(videos.id, 'vid00000001'))
        .run();

      createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [{ ...discovered('vid00000001', 'Renamed title'), durationS: 61 }],
      });

      const row = t.db.select().from(videos).where(eq(videos.id, 'vid00000001')).get();
      expect(row).toMatchObject({
        title: 'Renamed title', // metadata refreshed
        durationS: 61,
        status: 'fetched', // corpus fields untouched
        language: 'en',
        engine: 'youtubei.js',
        fetchedAt: '2026-10-08T09:00:00.000Z',
      });
    });
  });

  describe('claimNextPendingItem', () => {
    it('claims items oldest-job-first, discovery order within a job', () => {
      const job1 = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001'), discovered('vid00000002')],
      });
      const job2 = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000003')],
      });

      const first = claimNextPendingItem(t.db);
      const second = claimNextPendingItem(t.db);
      const third = claimNextPendingItem(t.db);

      expect(first?.item.videoId).toBe('vid00000001');
      expect(first?.job.id).toBe(job1.id);
      expect(second?.item.videoId).toBe('vid00000002');
      expect(third?.item.videoId).toBe('vid00000003');
      expect(third?.job.id).toBe(job2.id);
      expect(claimNextPendingItem(t.db)).toBeNull();
    });

    it('marks the claimed item running and moves a queued job to running', () => {
      const job = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001')],
      });

      const claimed = claimNextPendingItem(t.db);
      if (!claimed) throw new Error('expected a claimable item');

      expect(claimed.item.status).toBe('running');
      expect(claimed.item.startedAt).not.toBeNull();
      expect(getJob(t.db, job.id)?.status).toBe('running');
      expect(getItem(t.db, claimed.item.id)?.status).toBe('running');
    });

    it('skips items whose job is no longer active', () => {
      const job = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001')],
      });
      t.db.update(jobs).set({ status: 'cancelled' }).where(eq(jobs.id, job.id)).run();

      expect(claimNextPendingItem(t.db)).toBeNull();
    });

    it('ignores items of other job kinds', () => {
      createJob(t.db, { kind: 'embed', sourceId, videos: [discovered('vid00000001')] });

      expect(claimNextPendingItem(t.db, 'extract')).toBeNull();
      expect(claimNextPendingItem(t.db, 'embed')?.item.videoId).toBe('vid00000001');
    });
  });

  describe('item checkpoints', () => {
    it('markItemSucceeded checkpoints the item and bumps processedItems', () => {
      const job = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001')],
      });
      const claimed = claimNextPendingItem(t.db);
      if (!claimed) throw new Error('expected a claimable item');

      markItemSucceeded(t.db, claimed.item.id);

      const item = getItem(t.db, claimed.item.id);
      expect(item?.status).toBe('succeeded');
      expect(item?.finishedAt).not.toBeNull();
      expect(getJob(t.db, job.id)).toMatchObject({ processedItems: 1, failedItems: 0 });
    });

    it('markItemFailed records the error and bumps processed + failed counters', () => {
      const job = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001')],
      });
      const claimed = claimNextPendingItem(t.db);
      if (!claimed) throw new Error('expected a claimable item');

      markItemFailed(t.db, claimed.item.id, 'youtubei.js: unavailable: no transcript');

      const item = getItem(t.db, claimed.item.id);
      expect(item?.status).toBe('failed');
      expect(item?.error).toBe('youtubei.js: unavailable: no transcript');
      expect(item?.finishedAt).not.toBeNull();
      expect(getJob(t.db, job.id)).toMatchObject({ processedItems: 1, failedItems: 1 });
    });
  });

  describe('resetRunningItems', () => {
    it('resets running items to pending for re-claiming', () => {
      createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001'), discovered('vid00000002')],
      });
      const claimed = claimNextPendingItem(t.db);
      if (!claimed) throw new Error('expected a claimable item');
      markItemSucceeded(t.db, claimed.item.id);
      const second = claimNextPendingItem(t.db);
      if (!second) throw new Error('expected a second claimable item');
      // second is now 'running' — simulate a crash here.

      expect(resetRunningItems(t.db)).toBe(1);

      const item = getItem(t.db, second.item.id);
      expect(item?.status).toBe('pending');
      expect(item?.startedAt).toBeNull();
      // The succeeded item is untouched.
      expect(getItem(t.db, claimed.item.id)?.status).toBe('succeeded');
      // And the reset item is claimable again.
      expect(claimNextPendingItem(t.db)?.item.id).toBe(second.item.id);
    });
  });

  describe('completeDrainedJobs', () => {
    it('completes jobs with no pending/running items, including zero-item jobs', () => {
      const empty = createJob(t.db, { kind: 'extract', sourceId, videos: [] });
      const done = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001')],
      });
      const claimed = claimNextPendingItem(t.db);
      if (!claimed) throw new Error('expected a claimable item');
      markItemSucceeded(t.db, claimed.item.id);
      const open = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000002')],
      });

      const completed = completeDrainedJobs(t.db);

      expect(completed.sort()).toEqual([empty.id, done.id].sort());
      expect(getJob(t.db, empty.id)?.status).toBe('completed');
      expect(getJob(t.db, done.id)?.status).toBe('completed');
      expect(getJob(t.db, done.id)?.finishedAt).not.toBeNull();
      expect(getJob(t.db, open.id)?.status).toBe('queued');
    });

    it('does not complete a job while an item is running', () => {
      const job = createJob(t.db, {
        kind: 'extract',
        sourceId,
        videos: [discovered('vid00000001')],
      });
      const claimed = claimNextPendingItem(t.db);
      if (!claimed) throw new Error('expected a claimable item');

      expect(completeDrainedJobs(t.db)).toEqual([]);
      expect(getJob(t.db, job.id)?.status).toBe('running');
    });
  });
});
