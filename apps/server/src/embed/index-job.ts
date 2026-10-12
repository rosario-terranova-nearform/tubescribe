// Embedding jobs: chunk fetched transcripts, embed them via the injected
// Embedder, and store vectors in vec_chunks. An 'embed' job is chained
// automatically when an extraction job completes (chainEmbedJobs, wired in
// server.ts) and covers only videos that are fetched but not yet embedded —
// re-extraction resets embeddedAt so re-fetched videos are re-embedded.
// Per-video failures are recorded as data and never crash the job.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { chunks, videos } from '../db/schema.js';
import { TranscriptFileSchema, transcriptPaths } from '../jobs/files.js';
import {
  type ClaimedItem,
  type JobRow,
  claimNextPendingItem,
  createJob,
  markItemFailed,
  markItemSucceeded,
  resetRunningItems,
} from '../jobs/queue.js';
import { getSettings } from '../settings.js';
import { chunkTranscript } from './chunker.js';
import type { Embedder } from './embedder.js';
import {
  deleteVecRowsForSource,
  deleteVecRowsForVideo,
  ensureVecChunksTable,
  getEmbedState,
  insertChunkVectors,
  resetAllEmbeddings,
  setEmbedState,
} from './vec.js';

export type EmbedConfig = Pick<Config, 'dataDir' | 'defaultEmbeddingModel'>;

/** The embedding model to use now: settings override, else the env default. */
export function embeddingModelFor(db: Db, config: EmbedConfig): string {
  return getSettings(db).defaultEmbeddingModel ?? config.defaultEmbeddingModel;
}

/** Videos of the source that have a transcript but no embeddings yet. */
export function countEmbeddableVideos(db: Db, sourceId: string): number {
  return (
    db
      .select({ n: count() })
      .from(videos)
      .where(
        and(eq(videos.sourceId, sourceId), eq(videos.status, 'fetched'), isNull(videos.embeddedAt)),
      )
      .get()?.n ?? 0
  );
}

/**
 * Create an embed job for every fetched-but-not-embedded video of the
 * source. Zero-item jobs are allowed (they complete on the next drain).
 */
export function createEmbedJob(db: Db, sourceId: string): JobRow {
  const targets = db
    .select()
    .from(videos)
    .where(
      and(eq(videos.sourceId, sourceId), eq(videos.status, 'fetched'), isNull(videos.embeddedAt)),
    )
    .all();
  return createJob(db, {
    kind: 'embed',
    sourceId,
    videos: targets.map((v) => ({
      videoId: v.id,
      title: v.title,
      publishedAt: v.publishedAt,
      durationS: v.durationS,
    })),
  });
}

/**
 * Chain embedding onto extraction: for each completed extraction job, create
 * an embed job for its source when videos are waiting. Returns the created
 * jobs (caller notifies the embed worker).
 */
export function chainEmbedJobs(db: Db, completedJobs: JobRow[]): JobRow[] {
  const created: JobRow[] = [];
  for (const job of completedJobs) {
    if (job.kind !== 'extract') continue;
    if (countEmbeddableVideos(db, job.sourceId) === 0) continue;
    created.push(createEmbedJob(db, job.sourceId));
  }
  return created;
}

export interface EmbedPipelineDeps {
  db: Db;
  config: EmbedConfig;
  logger: Logger;
  embedder: Embedder;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Process one claimed embed item end to end. Never throws: per-video
 * failures are recorded on the job item and the job continues (the video
 * stays 'fetched' so a later reindex retries it).
 */
export async function processEmbedItem(
  deps: EmbedPipelineDeps,
  claimed: ClaimedItem,
): Promise<void> {
  const { db, config, logger, embedder } = deps;
  const { item, job } = claimed;
  const { videoId } = item;

  try {
    const video = db.select().from(videos).where(eq(videos.id, videoId)).get();
    if (!video) {
      logger.error({ videoId, jobId: job.id }, 'embed item references a missing video row');
      markItemFailed(db, item.id, `video row missing for ${videoId}`);
      return;
    }

    const { jsonPath } = transcriptPaths(config.dataDir, video.sourceId, videoId);
    const transcript = TranscriptFileSchema.parse(JSON.parse(readFileSync(jsonPath, 'utf8')));
    const videoChunks = chunkTranscript({
      videoId,
      sourceId: video.sourceId,
      title: video.title,
      segments: transcript.segments,
    });

    // Model-change guard: embeddings of different models must never mix in
    // one vector space. Reindexing (reindexSource) resets it explicitly.
    const model = embeddingModelFor(db, config);
    const state = getEmbedState(db);
    if (state && state.model !== model) {
      const message = `embedding model changed (${state.model} → ${model}); run POST /api/sources/:id/reindex to rebuild embeddings`;
      logger.warn({ videoId, jobId: job.id, model, storedModel: state.model }, message);
      markItemFailed(db, item.id, message);
      return;
    }

    if (videoChunks.length > 0) {
      const embeddings = await embedder.embed(
        model,
        videoChunks.map((c) => c.text),
      );
      if (embeddings.length !== videoChunks.length) {
        throw new Error(
          `embedder returned ${embeddings.length} vectors for ${videoChunks.length} chunks`,
        );
      }
      const dimension = embeddings[0]?.length ?? 0;
      // Pair chunks with their vectors up front so the transaction is a
      // straight insert (lengths are validated above).
      const rows = videoChunks.map((chunk, i) => {
        const embedding = embeddings[i];
        if (!embedding) throw new Error(`embedder returned no vector for chunk ${i}`);
        return { ...chunk, id: randomUUID(), embedding };
      });
      db.transaction((tx) => {
        // First-ever embed: create the vec table with the observed
        // dimension; otherwise this validates consistency (no-op).
        ensureVecChunksTable(db, dimension);
        if (!state) setEmbedState(db, { model, dimension });
        // Idempotent re-embed: replace the video's existing chunks.
        deleteVecRowsForVideo(db, videoId);
        tx.delete(chunks).where(eq(chunks.videoId, videoId)).run();
        tx.insert(chunks)
          .values(rows.map(({ embedding: _, ...chunk }) => chunk))
          .run();
        insertChunkVectors(
          db,
          rows.map((row) => ({
            chunkId: row.id,
            sourceId: row.sourceId,
            embedding: row.embedding,
          })),
        );
        tx.update(videos)
          .set({ status: 'embedded', embeddedAt: new Date().toISOString(), error: null })
          .where(eq(videos.id, videoId))
          .run();
      });
    } else {
      // Empty transcript: nothing to store, but the video is done — don't
      // let it be re-queued forever.
      db.update(videos)
        .set({ status: 'embedded', embeddedAt: new Date().toISOString(), error: null })
        .where(eq(videos.id, videoId))
        .run();
    }
    markItemSucceeded(db, item.id);
    logger.info({ videoId, jobId: job.id, chunks: videoChunks.length }, 'video embedded');
  } catch (err) {
    logger.error({ err, videoId, jobId: job.id }, 'embed pipeline error');
    markItemFailed(db, item.id, describe(err));
  }
}

export interface EmbedWorkerDeps extends EmbedPipelineDeps {
  /** Poll interval when the queue is drained (notify() wakes sooner). */
  idlePollMs?: number;
}

export interface EmbedWorker {
  start(): void;
  stop(): Promise<void>;
  notify(): void;
}

/**
 * Single-slot embed worker. Job completion (drain detection) is left to the
 * extraction worker — it is the sole completer so extract→embed chaining
 * sees every completed job exactly once.
 */
export function createEmbedWorker(deps: EmbedWorkerDeps): EmbedWorker {
  const { db, logger } = deps;
  const idlePollMs = deps.idlePollMs ?? 1000;

  let started = false;
  let stopped = false;
  let slot: Promise<void> | null = null;
  const wakers = new Set<() => void>();

  function wake(): void {
    for (const waker of [...wakers]) waker();
  }

  function idleWait(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wakers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, idlePollMs);
      wakers.add(done);
    });
  }

  async function run(): Promise<void> {
    while (!stopped) {
      try {
        const claimed = claimNextPendingItem(db, 'embed');
        if (!claimed) {
          if (stopped) break;
          await idleWait();
          continue;
        }
        await processEmbedItem(deps, claimed);
      } catch (err) {
        // processEmbedItem records per-video failures itself; reaching here
        // means a systemic error (e.g. DB). Log and back off.
        logger.error({ err }, 'embed worker error');
        await idleWait();
      }
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      const recovered = resetRunningItems(db, 'embed');
      if (recovered > 0) {
        logger.warn({ recovered }, 'reset running embed items to pending (crash recovery)');
      }
      slot = run();
    },
    async stop() {
      stopped = true;
      wake();
      await slot;
    },
    notify() {
      wake();
    },
  };
}

/**
 * POST /api/sources/:id/reindex: drop the source's chunks and rebuild them
 * via a fresh embed job. If the configured embedding model changed since the
 * vector space was built, this first resets ALL embeddings (a model change
 * invalidates every chunk — the dimension changes) and the other sources
 * must be reindexed too.
 */
export function reindexSource(
  deps: { db: Db; config: EmbedConfig; logger?: Logger },
  sourceId: string,
): JobRow {
  const { db, config, logger } = deps;
  const model = embeddingModelFor(db, config);
  const state = getEmbedState(db);
  if (state && state.model !== model) {
    logger?.warn(
      { from: state.model, to: model },
      'embedding model changed; resetting all embeddings (full reindex required)',
    );
    resetAllEmbeddings(db);
  }
  db.transaction((tx) => {
    deleteVecRowsForSource(db, sourceId);
    tx.delete(chunks).where(eq(chunks.sourceId, sourceId)).run();
    tx.update(videos)
      .set({ embeddedAt: null, status: 'fetched' })
      .where(and(eq(videos.sourceId, sourceId), eq(videos.status, 'embedded')))
      .run();
  });
  return createEmbedJob(db, sourceId);
}
