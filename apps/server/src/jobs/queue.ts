// SQLite-backed job queue: job + job_items creation, atomic item claiming,
// and per-item checkpoint updates. better-sqlite3 is synchronous, so every
// multi-row mutation runs in a transaction and claiming stays atomic even
// with transcriptConcurrency = 2.

import type { JobItemStatus, JobKind, JobStatus } from '@tubescribe/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobItems, jobs, videos } from '../db/schema.js';
import type { DiscoveredVideo } from '../youtube/types.js';

export type JobRow = typeof jobs.$inferSelect;
export type JobItemRow = typeof jobItems.$inferSelect;

export interface ClaimedItem {
  item: JobItemRow;
  job: JobRow;
}

const ACTIVE_JOB_STATUSES: JobStatus[] = ['queued', 'running'];
const OPEN_ITEM_STATUSES: JobItemStatus[] = ['pending', 'running'];

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Create a job plus one job_items row per discovered video, upserting the
 * video rows. The upsert refreshes discovery metadata only — corpus fields
 * (status, language, captionKind, engine, fetchedAt) survive re-extraction.
 */
export function createJob(
  db: Db,
  input: {
    kind: JobKind;
    sourceId: string;
    videos: DiscoveredVideo[];
  },
): JobRow {
  return db.transaction((tx) => {
    for (const video of input.videos) {
      tx.insert(videos)
        .values({
          id: video.videoId,
          sourceId: input.sourceId,
          title: video.title,
          url: videoUrl(video.videoId),
          publishedAt: video.publishedAt,
          durationS: video.durationS,
          // Unknown until the transcript is fetched.
          language: '',
        })
        .onConflictDoUpdate({
          target: videos.id,
          set: {
            title: video.title,
            url: videoUrl(video.videoId),
            publishedAt: video.publishedAt,
            durationS: video.durationS,
          },
        })
        .run();
    }

    const job = tx
      .insert(jobs)
      .values({
        kind: input.kind,
        sourceId: input.sourceId,
        status: 'queued',
        startedAt: new Date().toISOString(),
        totalItems: input.videos.length,
      })
      .returning()
      .get();
    if (!job) throw new Error('failed to insert job row');

    if (input.videos.length > 0) {
      tx.insert(jobItems)
        .values(input.videos.map((video) => ({ jobId: job.id, videoId: video.videoId })))
        .run();
    }
    return job;
  });
}

/**
 * Atomically claim the next pending item: oldest job (creation order) first,
 * then items in discovery order. Sets the item to running and the job to
 * running when it was queued. Returns null when nothing is claimable.
 */
export function claimNextPendingItem(db: Db, kind: JobKind = 'extract'): ClaimedItem | null {
  return db.transaction((tx) => {
    const found = tx
      .select({ item: jobItems, job: jobs })
      .from(jobItems)
      .innerJoin(jobs, eq(jobItems.jobId, jobs.id))
      .where(
        and(
          eq(jobItems.status, 'pending'),
          eq(jobs.kind, kind),
          inArray(jobs.status, ACTIVE_JOB_STATUSES),
        ),
      )
      .orderBy(asc(sql`${jobs}.rowid`), asc(sql`${jobItems}.rowid`))
      .limit(1)
      .all()[0];
    if (!found) return null;

    const now = new Date().toISOString();
    tx.update(jobItems)
      .set({ status: 'running', startedAt: now })
      .where(eq(jobItems.id, found.item.id))
      .run();
    if (found.job.status === 'queued') {
      tx.update(jobs).set({ status: 'running' }).where(eq(jobs.id, found.job.id)).run();
    }
    return { item: { ...found.item, status: 'running', startedAt: now }, job: found.job };
  });
}

/** Checkpoint: item succeeded. Bumps the job's processed counter. */
export function markItemSucceeded(db: Db, itemId: string): void {
  db.transaction((tx) => {
    const item = tx
      .update(jobItems)
      .set({ status: 'succeeded', finishedAt: new Date().toISOString(), error: null })
      .where(eq(jobItems.id, itemId))
      .returning()
      .get();
    if (!item) return;
    tx.update(jobs)
      .set({ processedItems: sql`${jobs.processedItems} + 1` })
      .where(eq(jobs.id, item.jobId))
      .run();
  });
}

/** Checkpoint: item failed with an error. Failures are data — the job continues. */
export function markItemFailed(db: Db, itemId: string, error: string): void {
  db.transaction((tx) => {
    const item = tx
      .update(jobItems)
      .set({ status: 'failed', finishedAt: new Date().toISOString(), error })
      .where(eq(jobItems.id, itemId))
      .returning()
      .get();
    if (!item) return;
    tx.update(jobs)
      .set({
        processedItems: sql`${jobs.processedItems} + 1`,
        failedItems: sql`${jobs.failedItems} + 1`,
      })
      .where(eq(jobs.id, item.jobId))
      .run();
  });
}

/**
 * Crash recovery on worker boot: items left 'running' by a killed process are
 * reset to 'pending' so they get re-claimed. Returns the number reset.
 */
export function resetRunningItems(db: Db, kind: JobKind = 'extract'): number {
  return db.transaction((tx) => {
    const stuck = tx
      .select({ id: jobItems.id })
      .from(jobItems)
      .innerJoin(jobs, eq(jobItems.jobId, jobs.id))
      .where(and(eq(jobItems.status, 'running'), eq(jobs.kind, kind)))
      .all();
    if (stuck.length === 0) return 0;
    tx.update(jobItems)
      .set({ status: 'pending', startedAt: null })
      .where(
        inArray(
          jobItems.id,
          stuck.map((row) => row.id),
        ),
      )
      .run();
    return stuck.length;
  });
}

/**
 * Complete every active job with no open (pending/running) items left,
 * including zero-item jobs. Returns the completed job ids.
 */
export function completeDrainedJobs(db: Db): string[] {
  return db.transaction((tx) => {
    const openJobIds = new Set(
      tx
        .selectDistinct({ jobId: jobItems.jobId })
        .from(jobItems)
        .where(inArray(jobItems.status, OPEN_ITEM_STATUSES))
        .all()
        .map((row) => row.jobId),
    );
    const drained = tx
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ACTIVE_JOB_STATUSES))
      .all()
      .filter((job) => !openJobIds.has(job.id));
    if (drained.length === 0) return [];
    tx.update(jobs)
      .set({ status: 'completed', finishedAt: new Date().toISOString() })
      .where(
        inArray(
          jobs.id,
          drained.map((job) => job.id),
        ),
      )
      .run();
    return drained.map((job) => job.id);
  });
}
