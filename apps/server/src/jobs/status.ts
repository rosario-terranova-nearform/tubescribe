// Aggregate extraction status: per source (video rows) and per job (item
// rows). Computed from the tables, not the job counter columns, so it stays
// correct even across crash recovery.

import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobItems, videos } from '../db/schema.js';

export interface SourceStatus {
  sourceId: string;
  total: number;
  pending: number;
  fetched: number;
  failed: number;
  embedded: number;
}

/** Per-source video status counts (pending / fetched / failed / embedded). */
export function getSourceStatus(db: Db, sourceId: string): SourceStatus {
  const rows = db
    .select({ status: videos.status, n: count() })
    .from(videos)
    .where(eq(videos.sourceId, sourceId))
    .groupBy(videos.status)
    .all();
  const byStatus = new Map(rows.map((row) => [row.status, row.n]));
  const status: SourceStatus = {
    sourceId,
    total: 0,
    pending: 0,
    fetched: 0,
    failed: 0,
    embedded: 0,
  };
  for (const key of ['pending', 'fetched', 'failed', 'embedded'] as const) {
    status[key] = byStatus.get(key) ?? 0;
    status.total += status[key];
  }
  return status;
}

export interface JobStatusCounts {
  jobId: string;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
}

/** Per-job item status counts (pending / running / succeeded / failed). */
export function getJobStatus(db: Db, jobId: string): JobStatusCounts {
  const rows = db
    .select({ status: jobItems.status, n: count() })
    .from(jobItems)
    .where(eq(jobItems.jobId, jobId))
    .groupBy(jobItems.status)
    .all();
  const byStatus = new Map(rows.map((row) => [row.status, row.n]));
  const status: JobStatusCounts = {
    jobId,
    total: 0,
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
  };
  for (const key of ['pending', 'running', 'succeeded', 'failed'] as const) {
    status[key] = byStatus.get(key) ?? 0;
    status.total += status[key];
  }
  return status;
}
