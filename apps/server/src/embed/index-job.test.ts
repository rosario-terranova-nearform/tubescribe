// Embed pipeline integration: extraction completion chains an embed job;
// per-video embeddedAt; already-embedded videos are skipped; failures are
// recorded per video; reindex rebuilds (and a model change resets the whole
// vector space). Fake engines + fake embedder — no network.

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunks as chunksTable, jobs, videos } from '../db/schema.js';
import { createJob } from '../jobs/queue.js';
import { type ExtractionWorker, createExtractionWorker } from '../jobs/worker.js';
import { createLogger } from '../logger.js';
import { updateSettings } from '../settings.js';
import { type FakeEmbedder, fakeEmbedder } from '../testing/fake-embedder.js';
import { alwaysOk, fakeEngine, okResult } from '../testing/fake-engines.js';
import { type TestDb, makeTestDb, seedSource } from '../testing/test-db.js';
import type { TranscriptEngine } from '../youtube/engines/engine.js';
import type { DiscoveredVideo } from '../youtube/types.js';
import {
  type EmbedWorker,
  chainEmbedJobs,
  countEmbeddableVideos,
  createEmbedJob,
  createEmbedWorker,
  reindexSource,
} from './index-job.js';
import { getEmbedState, vecChunksDimension } from './vec.js';

const discovered = (videoId: string): DiscoveredVideo => ({
  videoId,
  title: `Title ${videoId}`,
  publishedAt: '2023-03-05T00:00:00.000Z',
  durationS: 60,
});

interface Running {
  worker: ExtractionWorker;
  embedWorker: EmbedWorker;
}

interface Setup extends TestDb {
  embedder: FakeEmbedder;
  start: (engines?: TranscriptEngine[]) => Running;
  stopAll: () => Promise<void>;
  cleanup: () => Promise<void>;
}

function setup(): Setup {
  const t = makeTestDb({
    transcriptDelayMinMs: 1,
    transcriptDelayMaxMs: 2,
    transcriptMaxRetries: 0,
  });
  const embedder = fakeEmbedder();
  const logger = createLogger(t.config);
  const running: Running[] = [];
  return {
    ...t,
    embedder,
    start: (engines = [alwaysOk('youtubei.js')]) => {
      const embedWorker = createEmbedWorker({
        db: t.db,
        config: t.config,
        logger,
        embedder,
        idlePollMs: 5,
      });
      const worker = createExtractionWorker({
        db: t.db,
        config: t.config,
        logger,
        engines,
        idlePollMs: 5,
        sleep: () => Promise.resolve(),
        random: () => 0.5,
        // Same wiring as server.ts: extraction completion chains embed jobs.
        onJobsCompleted: (completed) => {
          if (chainEmbedJobs(t.db, completed).length > 0) embedWorker.notify();
        },
      });
      worker.start();
      embedWorker.start();
      const pair = { worker, embedWorker };
      running.push(pair);
      return pair;
    },
    stopAll: async () => {
      for (const { worker, embedWorker } of running) {
        await worker.stop();
        await embedWorker.stop();
      }
      running.length = 0;
    },
    cleanup: async () => {
      for (const { worker, embedWorker } of running) {
        await worker.stop();
        await embedWorker.stop();
      }
      t.cleanup();
    },
  };
}

/** Wait until every embed job for the source exists and has finished. */
async function waitForEmbedJobs(t: TestDb, sourceId: string, minCount = 1): Promise<void> {
  await vi.waitFor(
    () => {
      const embedJobs = t.db
        .select()
        .from(jobs)
        .where(sql`${jobs.kind} = 'embed' AND ${jobs.sourceId} = ${sourceId}`)
        .all();
      expect(embedJobs.length).toBeGreaterThanOrEqual(minCount);
      for (const job of embedJobs) {
        expect(['completed', 'failed', 'cancelled']).toContain(job.status);
      }
    },
    { timeout: 5000, interval: 10 },
  );
}

function waitForJobStatus(t: TestDb, jobId: string, status: string): Promise<void> {
  return vi.waitFor(
    () => {
      expect(t.db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe(status);
    },
    { timeout: 5000, interval: 10 },
  );
}

function getVideo(t: TestDb, videoId: string) {
  return t.db.select().from(videos).where(eq(videos.id, videoId)).get();
}

function vecRowCount(db: TestDb['db']): number {
  return db.get<{ n: number }>(sql`SELECT count(*) AS n FROM vec_chunks`)?.n ?? 0;
}

describe('embed pipeline', () => {
  let s: Setup;
  let sourceId: string;

  beforeEach(() => {
    s = setup();
    sourceId = seedSource(s.db);
  });

  afterEach(async () => {
    await s.cleanup();
  });

  it('extraction completion chains an embed job; videos get chunks, vectors, embeddedAt', async () => {
    const extractJob = createJob(s.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid00000001', 'vid00000002'].map(discovered),
    });

    s.start();
    await waitForJobStatus(s, extractJob.id, 'completed');
    await waitForEmbedJobs(s, sourceId);

    // Both videos embedded with citation-carrying chunks.
    const rows = s.db.select().from(videos).where(eq(videos.sourceId, sourceId)).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('embedded');
      expect(row.embeddedAt).not.toBeNull();
    }
    const storedChunks = s.db.select().from(chunksTable).all();
    expect(storedChunks).toHaveLength(2);
    for (const chunk of storedChunks) {
      expect(chunk.text).toBe('hello world');
      expect(chunk.title).toContain('Title vid');
      expect(chunk.startMs).toBe(0);
      expect(chunk.endMs).toBe(1500);
    }
    expect(vecRowCount(s.db)).toBe(2);
    expect(getEmbedState(s.db)).toEqual({ model: 'test/embed-model', dimension: 8 });
    expect(vecChunksDimension(s.db)).toBe(8);
    // The embedding model came from settings (seeded from config).
    expect(s.embedder.calls.every((c) => c.model === 'test/embed-model')).toBe(true);
  });

  it('skips already-embedded videos when chaining', async () => {
    const extractJob = createJob(s.db, {
      kind: 'extract',
      sourceId,
      videos: [discovered('vid00000001')],
    });
    s.start();
    await waitForEmbedJobs(s, sourceId);
    const jobsBefore = s.db.select().from(jobs).all().length;

    // Chaining the (already completed) extraction job again creates nothing.
    expect(chainEmbedJobs(s.db, [{ ...extractJob, status: 'completed' }])).toEqual([]);
    expect(countEmbeddableVideos(s.db, sourceId)).toBe(0);
    expect(s.db.select().from(jobs).all().length).toBe(jobsBefore);
  });

  it('a failing video fails its item and the job continues; the video stays fetched', async () => {
    const engines = [
      fakeEngine('youtubei.js', (videoId) =>
        videoId === 'vid-bad00000'
          ? okResult('youtubei.js', 'explode please')
          : okResult('youtubei.js'),
      ),
    ];
    s.embedder.embed = (model, texts) => {
      s.embedder.calls.push({ model, texts });
      if (texts.some((t) => t.includes('explode'))) throw new Error('openrouter exploded');
      return Promise.resolve(texts.map(() => [0.1, 0.2, 0.3, 0.4]));
    };
    createJob(s.db, {
      kind: 'extract',
      sourceId,
      videos: ['vid-ok0000000', 'vid-bad00000'].map(discovered),
    });

    s.start(engines);
    await waitForEmbedJobs(s, sourceId);

    expect(getVideo(s, 'vid-ok0000000')?.status).toBe('embedded');
    expect(getVideo(s, 'vid-bad00000')).toMatchObject({ status: 'fetched', embeddedAt: null });

    const embedJob = s.db.select().from(jobs).where(eq(jobs.kind, 'embed')).get();
    expect(embedJob).toMatchObject({ status: 'completed', processedItems: 2, failedItems: 1 });
  });

  it('embeds nothing for an empty transcript but still marks the video embedded', async () => {
    const engines = [
      fakeEngine('youtubei.js', () => ({
        segments: [],
        fullText: '',
        language: 'en',
        captionKind: 'manual' as const,
        engine: 'youtubei.js' as const,
      })),
    ];
    createJob(s.db, { kind: 'extract', sourceId, videos: [discovered('vid00000001')] });

    s.start(engines);
    await waitForEmbedJobs(s, sourceId);

    expect(getVideo(s, 'vid00000001')?.status).toBe('embedded');
    expect(getVideo(s, 'vid00000001')?.embeddedAt).not.toBeNull();
    expect(s.db.select().from(chunksTable).all()).toHaveLength(0);
    expect(s.embedder.calls).toHaveLength(0); // nothing to embed → no API call
  });

  it('re-extraction resets embeddedAt so the video is re-embedded (chunks replaced)', async () => {
    createJob(s.db, { kind: 'extract', sourceId, videos: [discovered('vid00000001')] });
    s.start();
    await waitForEmbedJobs(s, sourceId);
    expect(getVideo(s, 'vid00000001')?.status).toBe('embedded');
    const firstChunkIds = s.db
      .select({ id: chunksTable.id })
      .from(chunksTable)
      .all()
      .map((c) => c.id);

    // Re-extract (same transcript): the refetch invalidates the old chunks…
    const reextract = createJob(s.db, {
      kind: 'extract',
      sourceId,
      videos: [discovered('vid00000001')],
    });
    await waitForJobStatus(s, reextract.id, 'completed');
    // …and a chained embed job rebuilds them (new chunk ids, same count).
    await waitForEmbedJobs(s, sourceId, 2);

    expect(getVideo(s, 'vid00000001')?.status).toBe('embedded');
    const secondChunkIds = s.db
      .select({ id: chunksTable.id })
      .from(chunksTable)
      .all()
      .map((c) => c.id);
    expect(secondChunkIds).toHaveLength(1);
    expect(secondChunkIds[0]).not.toBe(firstChunkIds[0]);
    expect(vecRowCount(s.db)).toBe(1); // replaced, not duplicated
  });
});

describe('reindexSource', () => {
  let s: Setup;
  let sourceId: string;

  beforeEach(async () => {
    s = setup();
    sourceId = seedSource(s.db);
    createJob(s.db, { kind: 'extract', sourceId, videos: [discovered('vid00000001')] });
    const { worker, embedWorker } = s.start();
    await waitForEmbedJobs(s, sourceId);
    // Deterministic reindex assertions: no workers running anymore.
    await worker.stop();
    await embedWorker.stop();
  });

  afterEach(async () => {
    await s.cleanup();
  });

  it('drops the source chunks and queues a rebuild job', () => {
    expect(s.db.select().from(chunksTable).all()).toHaveLength(1);

    const job = reindexSource({ db: s.db, config: s.config }, sourceId);

    expect(job.kind).toBe('embed');
    expect(job.totalItems).toBe(1); // the embedded video is queued again
    // Old chunks + vectors are gone; the video is back to fetched.
    expect(s.db.select().from(chunksTable).all()).toHaveLength(0);
    expect(vecRowCount(s.db)).toBe(0);
    expect(getVideo(s, 'vid00000001')).toMatchObject({ status: 'fetched', embeddedAt: null });
  });

  it('a model change resets the WHOLE vector space (full reindex required)', () => {
    // A second source, already embedded in the old vector space.
    const other = seedSource(s.db, { id: 'source-other' });
    s.db
      .insert(videos)
      .values({
        id: 'vid-other-01',
        sourceId: other,
        title: 'Other',
        url: 'https://www.youtube.com/watch?v=vid-other-01',
        publishedAt: null,
        durationS: 10,
        language: 'en',
        status: 'embedded',
        embeddedAt: new Date().toISOString(),
      })
      .run();
    s.db
      .insert(chunksTable)
      .values({
        id: 'chunk-other',
        videoId: 'vid-other-01',
        sourceId: other,
        title: 'Other',
        startMs: 0,
        endMs: 1000,
        text: 'other chunk',
      })
      .run();

    // User changes the embedding model in settings.
    updateSettings(s.db, { defaultEmbeddingModel: 'test/other-model' });

    const job = reindexSource({ db: s.db, config: s.config }, sourceId);

    // Everything was reset: both sources' chunks/vectors gone, meta cleared,
    // embedded videos back to fetched; the vec table is recreated lazily.
    expect(s.db.select().from(chunksTable).all()).toHaveLength(0);
    expect(vecChunksDimension(s.db)).toBeNull();
    expect(getEmbedState(s.db)).toBeNull();
    expect(getVideo(s, 'vid-other-01')?.status).toBe('fetched');
    expect(job.totalItems).toBe(1); // only the requested source is queued
  });

  it('createEmbedJob on a source with nothing to embed creates a zero-item job', () => {
    const empty = seedSource(s.db, { id: 'source-empty' });
    const job = createEmbedJob(s.db, empty);
    expect(job.totalItems).toBe(0);
  });
});
