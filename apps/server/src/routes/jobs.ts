// Jobs REST API (task 06): the web header polls GET /api/jobs for active +
// recent jobs with progress counts (JobSchema carries total/processed/failed);
// detail returns the job with its items.

import {
  GetJobResponseSchema,
  type JobStatus,
  ListJobsQuerySchema,
  ListJobsResponseSchema,
} from '@tubescribe/shared';
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Express } from 'express';
import type { Db } from '../db/client.js';
import { jobItems, jobs } from '../db/schema.js';
import { HttpError } from '../http-error.js';

const ACTIVE_STATUSES: JobStatus[] = ['queued', 'running'];
/** How many finished jobs the default listing returns alongside active ones. */
const RECENT_LIMIT = 20;

export function registerJobsRoutes(app: Express, db: Db): void {
  app.get('/api/jobs', (req, res) => {
    const query = ListJobsQuerySchema.parse(req.query);
    const filters = [
      query.status ? eq(jobs.status, query.status) : undefined,
      query.kind ? eq(jobs.kind, query.kind) : undefined,
      query.sourceId ? eq(jobs.sourceId, query.sourceId) : undefined,
    ];
    // Active jobs first (oldest claim order), then the most recent finished.
    const active = db
      .select()
      .from(jobs)
      .where(and(inArray(jobs.status, ACTIVE_STATUSES), ...filters))
      .orderBy(asc(jobs.startedAt))
      .all();
    const recent = db
      .select()
      .from(jobs)
      .where(and(notInArray(jobs.status, ACTIVE_STATUSES), ...filters))
      .orderBy(desc(jobs.startedAt))
      .limit(RECENT_LIMIT)
      .all();
    res.json(ListJobsResponseSchema.parse({ jobs: [...active, ...recent] }));
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = db.select().from(jobs).where(eq(jobs.id, req.params.id)).get();
    if (!job) throw new HttpError(404, 'NOT_FOUND', `job not found: ${req.params.id}`);
    const items = db
      .select()
      .from(jobItems)
      .where(eq(jobItems.jobId, job.id))
      .orderBy(asc(sql`${jobItems}.rowid`))
      .all();
    res.json(GetJobResponseSchema.parse({ job, items }));
  });
}
