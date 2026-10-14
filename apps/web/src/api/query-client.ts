// TanStack Query client + job-polling helpers.
import { QueryClient } from '@tanstack/react-query';
import type { ListJobsResponse } from '@tubescribe/shared';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local single-user API: one retry is plenty, and the only fast-moving
      // data is job progress (covered by refetchInterval, not staleTime).
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** Global job polling cadence used by the header indicator and job pages. */
export const JOB_POLL_INTERVAL_MS = 3_000;

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);

export function hasActiveJobs(data: ListJobsResponse | undefined): boolean {
  return data?.jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status)) ?? false;
}

/**
 * refetchInterval helper for job-driven pages: poll at the job cadence while
 * any job is queued/running, stop once the corpus is idle. Usage:
 * `refetchInterval: (query) => pollWhileJobsActive(query.state.data)`.
 */
export function pollWhileJobsActive(data: ListJobsResponse | undefined): number | false {
  return hasActiveJobs(data) ? JOB_POLL_INTERVAL_MS : false;
}
