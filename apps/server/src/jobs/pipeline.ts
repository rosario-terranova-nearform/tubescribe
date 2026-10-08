// Per-video extraction pipeline: engine fallback chain with backoff, atomic
// file writes, and DB checkpoints. A failed video never fails a job —
// failures are recorded as data (status + error) and the job continues
// (docs/DESIGN.md).

import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { videos } from '../db/schema.js';
import { createDefaultClient, createTvEmbeddedClient } from '../youtube/client.js';
import { type TranscriptEngine, TranscriptError } from '../youtube/engines/engine.js';
import { YoutubeTranscriptEngine } from '../youtube/engines/youtube-transcript.js';
import { YoutubeiTranscriptEngine } from '../youtube/engines/youtubei.js';
import type { TranscriptResult } from '../youtube/types.js';
import { withBackoff } from './backoff.js';
import { writeTranscriptFiles } from './files.js';
import { type ClaimedItem, markItemFailed, markItemSucceeded } from './queue.js';

export type PipelineConfig = Pick<
  Config,
  'dataDir' | 'transcriptDelayMinMs' | 'transcriptDelayMaxMs' | 'transcriptMaxRetries'
>;

export interface PipelineDeps {
  db: Db;
  config: PipelineConfig;
  logger: Logger;
  engines: TranscriptEngine[];
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

/**
 * Production fallback chain (bot-detection defense, youtubei.js issues #1102
 * / #1119): youtubei.js → youtubei.js TV_EMBEDDED → youtube-transcript.
 */
export function createDefaultEngines(): TranscriptEngine[] {
  return [
    new YoutubeiTranscriptEngine(createDefaultClient),
    new YoutubeiTranscriptEngine(createTvEmbeddedClient, 'youtubei.js-tv-embedded'),
    new YoutubeTranscriptEngine(),
  ];
}

type FetchOutcome = { ok: true; result: TranscriptResult } | { ok: false; error: string };

/**
 * Try each engine in order. Rate-limited failures retry with backoff; any
 * failure moves to the next engine. Never throws — an exhausted chain returns
 * the per-engine errors joined into one message.
 */
async function fetchWithFallback(deps: PipelineDeps, videoId: string): Promise<FetchOutcome> {
  const { config, engines, logger, sleep, random } = deps;
  const failures: string[] = [];

  for (const engine of engines) {
    try {
      const result = await withBackoff(() => engine.fetch(videoId), {
        baseMs: config.transcriptDelayMinMs,
        capMs: config.transcriptDelayMaxMs * 2 ** config.transcriptMaxRetries,
        maxRetries: config.transcriptMaxRetries,
        sleep,
        random,
        shouldRetry: (err) => err instanceof TranscriptError && err.code === 'rate-limited',
        onRetry: (err, attempt, delayMs) =>
          logger.warn(
            { videoId, engine: engine.name, attempt, delayMs, err },
            'transcript fetch rate-limited; backing off',
          ),
      });
      return { ok: true, result };
    } catch (err) {
      if (!(err instanceof TranscriptError)) {
        logger.error({ err, videoId, engine: engine.name }, 'unexpected engine error');
      }
      failures.push(`${engine.name}: ${describeError(err)}`);
    }
  }
  return { ok: false, error: failures.join(' | ') };
}

function describeError(err: unknown): string {
  if (err instanceof TranscriptError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Process one claimed item end to end. Never throws: per-video failures are
 * recorded on the videos row + job item and the job continues.
 */
export async function processClaimedItem(deps: PipelineDeps, claimed: ClaimedItem): Promise<void> {
  const { db, config, logger } = deps;
  const { item, job } = claimed;
  const { videoId } = item;

  const video = db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video) {
    logger.error({ videoId, jobId: job.id }, 'job item references a missing video row');
    markItemFailed(db, item.id, `video row missing for ${videoId}`);
    return;
  }

  try {
    const outcome = await fetchWithFallback(deps, videoId);
    if (!outcome.ok) {
      db.update(videos)
        .set({ status: 'failed', error: outcome.error })
        .where(eq(videos.id, videoId))
        .run();
      markItemFailed(db, item.id, outcome.error);
      logger.warn({ videoId, jobId: job.id, error: outcome.error }, 'transcript extraction failed');
      return;
    }

    const fetchedAt = new Date().toISOString();
    const { result } = outcome;
    // Files first: on a crash before the checkpoint the video stays
    // pending/running and the resume refetches + rewrites idempotently.
    writeTranscriptFiles(config.dataDir, {
      videoId,
      sourceId: job.sourceId,
      title: video.title,
      url: video.url,
      publishedAt: video.publishedAt,
      durationS: video.durationS,
      language: result.language,
      captionKind: result.captionKind,
      engine: result.engine,
      fetchedAt,
      segments: result.segments,
      fullText: result.fullText,
    });
    db.update(videos)
      .set({
        status: 'fetched',
        language: result.language,
        captionKind: result.captionKind,
        engine: result.engine,
        fetchedAt,
        error: null,
      })
      .where(eq(videos.id, videoId))
      .run();
    markItemSucceeded(db, item.id);
    logger.info({ videoId, jobId: job.id, engine: result.engine }, 'transcript fetched');
  } catch (err) {
    // Belt+braces: a job must never crash on a per-video failure (e.g. disk
    // error on write). Systemic errors (DB down) surface via the worker loop.
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, videoId, jobId: job.id }, 'extraction pipeline error');
    db.update(videos).set({ status: 'failed', error: message }).where(eq(videos.id, videoId)).run();
    markItemFailed(db, item.id, message);
  }
}
