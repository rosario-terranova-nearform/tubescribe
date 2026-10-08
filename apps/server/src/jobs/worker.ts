// Extraction worker: the long-running loop started with the server process.
//
// - On boot, resumes queued/running jobs; items left 'running' by a killed
//   process are reset to 'pending' and re-claimed (fetched items are never
//   refetched — only pending items are claimed).
// - Transcript fetch concurrency comes from config (default 1, max 2); each
//   slot applies a randomized delay before every fetch (bot-detection
//   defense, docs/DESIGN.md).
// - All knobs come from the injected config; nothing reads env here.

import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { TranscriptEngine } from '../youtube/engines/engine.js';
import { createDefaultEngines, processClaimedItem } from './pipeline.js';
import { claimNextPendingItem, completeDrainedJobs, resetRunningItems } from './queue.js';

export type WorkerConfig = Pick<
  Config,
  | 'dataDir'
  | 'transcriptConcurrency'
  | 'transcriptDelayMinMs'
  | 'transcriptDelayMaxMs'
  | 'transcriptMaxRetries'
>;

export interface WorkerDeps {
  db: Db;
  config: WorkerConfig;
  logger: Logger;
  /** Defaults to the production fallback chain (see pipeline.ts). */
  engines?: TranscriptEngine[];
  sleep?: (ms: number) => Promise<void>;
  /** Random source in [0, 1) — injectable for deterministic tests. */
  random?: () => number;
  /** Poll interval when the queue is drained (notify() wakes sooner). */
  idlePollMs?: number;
}

export interface ExtractionWorker {
  start(): void;
  /** Graceful stop: in-flight items finish, no new items are claimed. */
  stop(): Promise<void>;
  /** Wake idle slots immediately (call after creating a job). */
  notify(): void;
}

/** Random integer delay in [minMs, maxMs]; tolerant of min > max misconfig. */
export function randomDelayMs(
  minMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return Math.floor(lo + random() * (hi - lo + 1));
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createExtractionWorker(deps: WorkerDeps): ExtractionWorker {
  const { db, config, logger } = deps;
  const engines = deps.engines ?? createDefaultEngines();
  const sleep = deps.sleep ?? realSleep;
  const random = deps.random ?? Math.random;
  const idlePollMs = deps.idlePollMs ?? 1000;

  let started = false;
  let stopped = false;
  const slots: Promise<void>[] = [];
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

  async function runSlot(slot: number): Promise<void> {
    while (!stopped) {
      try {
        const claimed = claimNextPendingItem(db);
        if (!claimed) {
          completeDrainedJobs(db);
          if (stopped) break;
          await idleWait();
          continue;
        }
        await sleep(
          randomDelayMs(config.transcriptDelayMinMs, config.transcriptDelayMaxMs, random),
        );
        await processClaimedItem({ db, config, logger, engines, sleep, random }, claimed);
      } catch (err) {
        // processClaimedItem records per-video failures itself; reaching here
        // means a systemic error (e.g. DB). Log and back off instead of
        // hot-spinning.
        logger.error({ err, slot }, 'worker slot error');
        await idleWait();
      }
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      const recovered = resetRunningItems(db);
      if (recovered > 0) {
        logger.warn({ recovered }, 'reset running items to pending (crash recovery)');
      }
      for (let slot = 0; slot < config.transcriptConcurrency; slot++) {
        slots.push(runSlot(slot));
      }
    },
    async stop() {
      stopped = true;
      wake();
      await Promise.all(slots);
    },
    notify() {
      wake();
    },
  };
}
