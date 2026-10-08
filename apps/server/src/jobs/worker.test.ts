import { existsSync, readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobItems, jobs, videos } from '../db/schema.js';
import { createLogger } from '../logger.js';
import {
  alwaysOk,
  fakeEngine,
  okResult,
  rateLimited,
  unavailable,
} from '../testing/fake-engines.js';
import { type TestDb, makeTestDb, seedSource } from '../testing/test-db.js';
import type { DiscoveredVideo } from '../youtube/types.js';
import { transcriptPaths } from './files.js';
import { processClaimedItem } from './pipeline.js';
import { claimNextPendingItem, createJob } from './queue.js';
import { type WorkerDeps, createExtractionWorker, randomDelayMs } from './worker.js';

const discovered = (videoId: string): DiscoveredVideo => ({
  videoId,
  title: `Title ${videoId}`,
  publishedAt: '2023-03-05T00:00:00.000Z',
  durationS: 60,
});

describe('randomDelayMs', () => {
  it('stays within [min, max]', () => {
    for (const random of [() => 0, () => 0.5, () => 0.99999, Math.random]) {
      for (let i = 0; i < 100; i++) {
        const delay = randomDelayMs(1000, 3000, random);
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(3000);
        expect(Number.isInteger(delay)).toBe(true);
      }
    }
  });

  it('is deterministic at the extremes of random()', () => {
    expect(randomDelayMs(1000, 3000, () => 0)).toBe(1000);
    // floor(1000 + 0.5 * 2001) = 2000
    expect(randomDelayMs(1000, 3000, () => 0.5)).toBe(2000);
    expect(randomDelayMs(1000, 3000, () => 0.99999)).toBe(3000);
  });

  it('handles min == max and min > max', () => {
    expect(randomDelayMs(1500, 1500)).toBe(1500);
    expect(randomDelayMs(3000, 1000, () => 0)).toBe(1000);
    expect(randomDelayMs(3000, 1000, () => 0.99999)).toBe(3000);
  });
});

describe('ExtractionWorker', () => {
  let t: TestDb;
  let sourceId: string;
  let sleeps: number[];

  beforeEach(() => {
    t = makeTestDb({
      transcriptDelayMinMs: 100,
      transcriptDelayMaxMs: 200,
      transcriptMaxRetries: 1,
    });
    sourceId = seedSource(t.db);
    sleeps = [];
  });

  afterEach(() => {
    t.cleanup();
  });

  function workerDeps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
    return {
      db: t.db,
      config: t.config,
      logger: createLogger(t.config),
      engines: [],
      idlePollMs: 5,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
      ...overrides,
    };
  }

  function getJob(jobId: string) {
    return t.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  }

  function itemStatuses(jobId: string): Record<string, string> {
    const items = t.db.select().from(jobItems).where(eq(jobItems.jobId, jobId)).all();
    return Object.fromEntries(items.map((i) => [i.videoId, i.status]));
  }

  async function waitForJob(jobId: string, status = 'completed'): Promise<void> {
    await vi.waitFor(
      () => {
        expect(getJob(jobId)?.status).toBe(status);
      },
      { timeout: 2000, interval: 5 },
    );
  }

  it('processes a job end to end: mixed ok / flaky / failing videos', async () => {
    const first = fakeEngine('youtubei.js', (videoId, callCount) => {
      if (videoId === 'vid-flaky000' && callCount === 1) throw rateLimited(videoId);
      if (videoId === 'vid-unavail0') throw unavailable(videoId);
      if (videoId === 'vid-ratelimit') throw rateLimited(videoId);
      return okResult('youtubei.js');
    });
    const second = fakeEngine('youtube-transcript', (videoId) => {
      if (videoId === 'vid-unavail0' || videoId === 'vid-ratelimit') throw unavailable(videoId);
      return okResult('youtube-transcript');
    });
    const job = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid-ok0000000', 'vid-flaky000', 'vid-unavail0', 'vid-ratelimit'].map(discovered),
    });

    const worker = createExtractionWorker(workerDeps({ engines: [first, second] }));
    worker.start();
    await waitForJob(job.id);
    await worker.stop();

    // Item statuses: a failed video never fails the job.
    expect(itemStatuses(job.id)).toEqual({
      'vid-ok0000000': 'succeeded',
      'vid-flaky000': 'succeeded',
      'vid-unavail0': 'failed',
      'vid-ratelimit': 'failed',
    });
    expect(getJob(job.id)).toMatchObject({
      status: 'completed',
      totalItems: 4,
      processedItems: 4,
      failedItems: 2,
    });

    // Videos rows: fetched items carry engine/language; failures carry errors.
    const rows = t.db.select().from(videos).where(eq(videos.sourceId, sourceId)).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('vid-ok0000000')).toMatchObject({ status: 'fetched', engine: 'youtubei.js' });
    expect(byId.get('vid-flaky000')).toMatchObject({ status: 'fetched', engine: 'youtubei.js' });
    expect(byId.get('vid-unavail0')?.status).toBe('failed');
    expect(byId.get('vid-unavail0')?.error).toContain('unavailable');
    expect(byId.get('vid-ratelimit')?.error).toContain('rate-limited');

    // Flaky recovered on retry: first engine fetched it twice.
    expect(first.calls.filter((v) => v === 'vid-flaky000')).toHaveLength(2);
    // Rate-limited past maxRetries falls through to the next engine.
    expect(first.calls.filter((v) => v === 'vid-ratelimit')).toHaveLength(2);
    expect(second.calls).toContain('vid-ratelimit');

    // Files on disk only for fetched videos.
    for (const [videoId, status] of Object.entries(itemStatuses(job.id))) {
      const { jsonPath, mdPath } = transcriptPaths(t.config.dataDir, sourceId, videoId);
      expect(existsSync(jsonPath), `${videoId} json`).toBe(status === 'succeeded');
      expect(existsSync(mdPath), `${videoId} md`).toBe(status === 'succeeded');
    }
    const json = JSON.parse(
      readFileSync(transcriptPaths(t.config.dataDir, sourceId, 'vid-ok0000000').jsonPath, 'utf8'),
    );
    expect(json).toMatchObject({
      videoId: 'vid-ok0000000',
      sourceId,
      engine: 'youtubei.js',
      language: 'en',
    });
  });

  it('applies a randomized delay within [min, max] before every fetch', async () => {
    const job = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid00000001', 'vid00000002', 'vid00000003'].map(discovered),
    });

    const worker = createExtractionWorker(workerDeps({ engines: [alwaysOkEngine()] }));
    worker.start();
    await waitForJob(job.id);
    await worker.stop();

    // One delay per fetched item (no retries in this test), each in bounds.
    expect(sleeps).toHaveLength(3);
    for (const delay of sleeps) {
      expect(delay).toBeGreaterThanOrEqual(t.config.transcriptDelayMinMs);
      expect(delay).toBeLessThanOrEqual(t.config.transcriptDelayMaxMs);
      // random = 0.5 → floor(100 + 0.5 * 101) = 150
      expect(delay).toBe(150);
    }
  });

  it('resume: after a crash mid-job, pending items continue and fetched items are not refetched', async () => {
    // Craft the exact DB/disk state a crash leaves behind: A fully fetched
    // (via the real pipeline), B stuck 'running', C still pending.
    const job = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid0000000a', 'vid0000000b', 'vid0000000c'].map(discovered),
    });
    const claimedA = claimNextPendingItem(t.db);
    if (!claimedA) throw new Error('expected item A');
    await processClaimedItem(
      {
        db: t.db,
        config: t.config,
        logger: createLogger(t.config),
        engines: [alwaysOkEngine()],
        sleep: () => Promise.resolve(),
        random: () => 0.5,
      },
      claimedA,
    );
    const claimedB = claimNextPendingItem(t.db);
    if (!claimedB) throw new Error('expected item B');
    // B is now 'running' — the "crash" happens here.

    const aJsonPath = transcriptPaths(t.config.dataDir, sourceId, 'vid0000000a').jsonPath;
    const aJsonBefore = readFileSync(aJsonPath, 'utf8');
    const aFetchedAt = t.db
      .select()
      .from(videos)
      .where(eq(videos.id, 'vid0000000a'))
      .get()?.fetchedAt;

    // "Restart": a fresh worker on the same DB.
    const engine = alwaysOkEngine();
    const worker = createExtractionWorker(workerDeps({ engines: [engine] }));
    worker.start();
    await waitForJob(job.id);
    await worker.stop();

    // B and C were fetched; A was not refetched.
    expect(engine.calls.sort()).toEqual(['vid0000000b', 'vid0000000c']);
    expect(itemStatuses(job.id)).toEqual({
      vid0000000a: 'succeeded',
      vid0000000b: 'succeeded',
      vid0000000c: 'succeeded',
    });
    expect(getJob(job.id)).toMatchObject({ status: 'completed', processedItems: 3 });
    // A's artifacts are untouched.
    expect(readFileSync(aJsonPath, 'utf8')).toBe(aJsonBefore);
    expect(t.db.select().from(videos).where(eq(videos.id, 'vid0000000a')).get()?.fetchedAt).toBe(
      aFetchedAt,
    );
  });

  it('graceful stop finishes the in-flight item and a restarted worker continues the job', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const first = fakeEngine('youtubei.js', async (videoId) => {
      if (videoId === 'vid0000000b') await gate;
      return okResult('youtubei.js');
    });
    const job = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid0000000a', 'vid0000000b', 'vid0000000c'].map(discovered),
    });

    const worker1 = createExtractionWorker(workerDeps({ engines: [first] }));
    worker1.start();
    // Wait until B is claimed (A already processed).
    await vi.waitFor(
      () => {
        expect(itemStatuses(job.id).vid0000000b).toBe('running');
      },
      { timeout: 2000, interval: 5 },
    );

    const stopped = worker1.stop();
    releaseGate();
    await stopped;

    // B finished, C was never claimed.
    expect(itemStatuses(job.id)).toMatchObject({
      vid0000000a: 'succeeded',
      vid0000000b: 'succeeded',
      vid0000000c: 'pending',
    });
    expect(first.calls).toEqual(['vid0000000a', 'vid0000000b']);

    // Restart: only C is fetched.
    const second = alwaysOkEngine();
    const worker2 = createExtractionWorker(workerDeps({ engines: [second] }));
    worker2.start();
    await waitForJob(job.id);
    await worker2.stop();

    expect(second.calls).toEqual(['vid0000000c']);
    expect(itemStatuses(job.id).vid0000000c).toBe('succeeded');
  });

  it('runs two fetch slots concurrently when transcriptConcurrency = 2', async () => {
    // Barrier: both fetches must be in flight before either resolves — passes
    // only if two slots fetch concurrently.
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const engine = fakeEngine('youtubei.js', async () => {
      arrived += 1;
      if (arrived === 2) releaseAll();
      await allArrived;
      return okResult('youtubei.js');
    });
    const job = createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid00000001', 'vid00000002'].map(discovered),
    });

    const worker = createExtractionWorker(
      workerDeps({ engines: [engine], config: { ...t.config, transcriptConcurrency: 2 } }),
    );
    worker.start();
    await waitForJob(job.id);
    await worker.stop();

    expect(arrived).toBe(2);
    expect(getJob(job.id)?.status).toBe('completed');
  });

  it('completes zero-item jobs created before boot', async () => {
    const job = createJob(t.db, { kind: 'extract', sourceId, videos: [] });

    const worker = createExtractionWorker(workerDeps({ engines: [alwaysOk('youtubei.js')] }));
    worker.start();
    await waitForJob(job.id);
    await worker.stop();

    expect(getJob(job.id)?.status).toBe('completed');
  });

  it('notify() wakes an idle worker to pick up a new job', async () => {
    const worker = createExtractionWorker(
      workerDeps({ engines: [alwaysOk('youtubei.js')], idlePollMs: 60_000 }),
    );
    worker.start();

    // Create the job after the worker has gone idle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const job = createJob(t.db, { kind: 'extract', sourceId, videos: [discovered('vid00000001')] });
    worker.notify();

    await waitForJob(job.id);
    await worker.stop();
    expect(getJob(job.id)?.status).toBe('completed');
  });
});

function alwaysOkEngine() {
  return alwaysOk('youtubei.js');
}
