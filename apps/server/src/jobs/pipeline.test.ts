import { existsSync, readFileSync } from 'node:fs';
import type { Engine } from '@tubescribe/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { transcriptPaths } from './files.js';
import { type PipelineDeps, processClaimedItem } from './pipeline.js';
import { type ClaimedItem, claimNextPendingItem, createJob } from './queue.js';

const VIDEO_ID = 'vid00000001';

describe('pipeline', () => {
  let t: TestDb;
  let sourceId: string;
  let sleeps: number[];

  beforeEach(() => {
    t = makeTestDb({ transcriptDelayMinMs: 10, transcriptDelayMaxMs: 20, transcriptMaxRetries: 2 });
    sourceId = seedSource(t.db);
    sleeps = [];
  });

  afterEach(() => {
    t.cleanup();
  });

  function deps(
    engines: PipelineDeps['engines'],
    configPatch: Partial<PipelineDeps['config']> = {},
  ): PipelineDeps {
    return {
      db: t.db,
      config: { ...t.config, ...configPatch },
      logger: createLogger(t.config),
      engines,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    };
  }

  /** Create a one-video job and claim its item. */
  function setup(videoId = VIDEO_ID): ClaimedItem {
    createJob(t.db, {
      kind: 'extract',
      sourceId,
      videos: [{ videoId, title: `Title ${videoId}`, publishedAt: null, durationS: 42 }],
    });
    const claimed = claimNextPendingItem(t.db);
    if (!claimed) throw new Error('expected a claimable item');
    return claimed;
  }

  it('success: writes files, updates the videos row, marks the item succeeded', async () => {
    const engine = alwaysOk('youtubei.js');
    const claimed = setup();

    await processClaimedItem(deps([engine]), claimed);

    const video = t.db.select().from(videos).where(eq(videos.id, VIDEO_ID)).get();
    expect(video).toMatchObject({
      status: 'fetched',
      language: 'en',
      captionKind: 'manual',
      engine: 'youtubei.js',
      error: null,
    });
    expect(video?.fetchedAt).not.toBeNull();

    const item = t.db.select().from(jobItems).where(eq(jobItems.id, claimed.item.id)).get();
    expect(item?.status).toBe('succeeded');

    const job = t.db.select().from(jobs).where(eq(jobs.id, claimed.job.id)).get();
    expect(job).toMatchObject({ processedItems: 1, failedItems: 0 });

    const { jsonPath, mdPath } = transcriptPaths(t.config.dataDir, sourceId, VIDEO_ID);
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(json).toMatchObject({
      videoId: VIDEO_ID,
      sourceId,
      title: 'Title vid00000001',
      language: 'en',
      captionKind: 'manual',
      engine: 'youtubei.js',
      fullText: 'hello world',
    });
    expect(readFileSync(mdPath, 'utf8')).toContain('hello world');
  });

  it('fallback: a rate-limited first engine exhausts its retries, the second engine succeeds', async () => {
    const first = fakeEngine('youtubei.js', (videoId) => {
      throw rateLimited(videoId);
    });
    const second = alwaysOk('youtube-transcript');
    const claimed = setup();

    await processClaimedItem(deps([first, second]), claimed);

    // maxRetries = 2 → 3 attempts on the first engine, then the fallback.
    expect(first.calls).toEqual([VIDEO_ID, VIDEO_ID, VIDEO_ID]);
    expect(second.calls).toEqual([VIDEO_ID]);
    // Two backoff sleeps between the first engine's attempts.
    expect(sleeps).toHaveLength(2);

    const video = t.db.select().from(videos).where(eq(videos.id, VIDEO_ID)).get();
    expect(video?.status).toBe('fetched');
    expect(video?.engine).toBe('youtube-transcript');
  });

  it('flaky-then-ok: a rate-limited engine that recovers within maxRetries succeeds', async () => {
    const engine = fakeEngine('youtubei.js', (videoId, callCount) => {
      if (callCount < 3) throw rateLimited(videoId);
      return okResult('youtubei.js');
    });
    const claimed = setup();

    await processClaimedItem(deps([engine]), claimed);

    expect(engine.calls).toEqual([VIDEO_ID, VIDEO_ID, VIDEO_ID]);
    expect(sleeps).toHaveLength(2);
    const video = t.db.select().from(videos).where(eq(videos.id, VIDEO_ID)).get();
    expect(video?.status).toBe('fetched');
    expect(video?.engine).toBe('youtubei.js');
  });

  it('unavailable is not retried on the same engine — it falls through immediately', async () => {
    const first = fakeEngine('youtubei.js', (videoId) => {
      throw unavailable(videoId);
    });
    const second = fakeEngine('youtube-transcript', () => okResult('youtube-transcript'));
    const claimed = setup();

    await processClaimedItem(deps([first, second]), claimed);

    expect(first.calls).toEqual([VIDEO_ID]); // no retries, no backoff sleeps
    expect(second.calls).toEqual([VIDEO_ID]);
    expect(sleeps).toEqual([]);
    expect(t.db.select().from(videos).where(eq(videos.id, VIDEO_ID)).get()?.status).toBe('fetched');
  });

  it('always-fail: the item and video are marked failed with the engine errors; no files written', async () => {
    const engines: Engine[] = ['youtubei.js', 'youtubei.js-tv-embedded', 'youtube-transcript'];
    const chain = engines.map((name) =>
      fakeEngine(name, (videoId) => {
        throw unavailable(videoId);
      }),
    );
    const claimed = setup();

    await processClaimedItem(deps(chain), claimed);

    const item = t.db.select().from(jobItems).where(eq(jobItems.id, claimed.item.id)).get();
    expect(item?.status).toBe('failed');
    expect(item?.error).toContain('youtubei.js: unavailable');
    expect(item?.error).toContain('youtube-transcript: unavailable');

    const video = t.db.select().from(videos).where(eq(videos.id, VIDEO_ID)).get();
    expect(video?.status).toBe('failed');
    expect(video?.error).toBe(item?.error);

    const job = t.db.select().from(jobs).where(eq(jobs.id, claimed.job.id)).get();
    expect(job).toMatchObject({ processedItems: 1, failedItems: 1 });

    const { jsonPath, mdPath } = transcriptPaths(t.config.dataDir, sourceId, VIDEO_ID);
    expect(existsSync(jsonPath)).toBe(false);
    expect(existsSync(mdPath)).toBe(false);
  });

  it('unexpected (non-TranscriptError) failures fail the item instead of crashing the job', async () => {
    const buggy = fakeEngine('youtubei.js', () => {
      throw new TypeError('cannot read properties of undefined');
    });
    const claimed = setup();

    await expect(processClaimedItem(deps([buggy]), claimed)).resolves.toBeUndefined();

    const item = t.db.select().from(jobItems).where(eq(jobItems.id, claimed.item.id)).get();
    expect(item?.status).toBe('failed');
    expect(item?.error).toContain('cannot read properties of undefined');
  });

  it('a missing video row fails the item instead of crashing', async () => {
    const claimed = setup();
    t.db.delete(videos).where(eq(videos.id, VIDEO_ID)).run();

    await expect(
      processClaimedItem(deps([alwaysOk('youtubei.js')]), claimed),
    ).resolves.toBeUndefined();

    const item = t.db.select().from(jobItems).where(eq(jobItems.id, claimed.item.id)).get();
    expect(item?.status).toBe('failed');
    expect(item?.error).toContain('missing');
  });

  it('respects TRANSCRIPT_MAX_RETRIES = 0 (no retries)', async () => {
    const engine = fakeEngine('youtubei.js', (videoId) => {
      throw rateLimited(videoId);
    });
    const claimed = setup();

    await processClaimedItem(deps([engine], { transcriptMaxRetries: 0 }), claimed);

    expect(engine.calls).toEqual([VIDEO_ID]);
    expect(t.db.select().from(jobItems).where(eq(jobItems.id, claimed.item.id)).get()?.status).toBe(
      'failed',
    );
  });
});
