// Query hooks for the jobs API.
import { useQuery } from '@tanstack/react-query';
import { ListJobsResponseSchema } from '@tubescribe/shared';
import { apiFetch } from './client.ts';
import { JOB_POLL_INTERVAL_MS, pollWhileJobsActive } from './query-client.ts';

export const jobsQueryKey = ['jobs'] as const;

/** Polls GET /api/jobs at the global job cadence (used by the header indicator). */
export function useJobs() {
  return useQuery({
    queryKey: jobsQueryKey,
    queryFn: ({ signal }) => apiFetch(ListJobsResponseSchema, '/jobs', { signal }),
    refetchInterval: JOB_POLL_INTERVAL_MS,
  });
}

export const sourceJobsQueryKey = (sourceId: string) => [...jobsQueryKey, { sourceId }] as const;

/**
 * Jobs for one source. Polls at the job cadence only while at least one job
 * for this source is queued/running; stops when the source is idle.
 */
export function useSourceJobs(sourceId: string) {
  return useQuery({
    queryKey: sourceJobsQueryKey(sourceId),
    queryFn: ({ signal }) =>
      apiFetch(ListJobsResponseSchema, `/jobs?sourceId=${encodeURIComponent(sourceId)}`, {
        signal,
      }),
    refetchInterval: (query) => pollWhileJobsActive(query.state.data),
  });
}
