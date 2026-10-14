// Query hooks for the jobs API.
import { useQuery } from '@tanstack/react-query';
import { ListJobsResponseSchema } from '@tubescribe/shared';
import { apiFetch } from './client.ts';
import { JOB_POLL_INTERVAL_MS } from './query-client.ts';

export const jobsQueryKey = ['jobs'] as const;

/** Polls GET /api/jobs at the global job cadence (used by the header indicator). */
export function useJobs() {
  return useQuery({
    queryKey: jobsQueryKey,
    queryFn: ({ signal }) => apiFetch(ListJobsResponseSchema, '/jobs', { signal }),
    refetchInterval: JOB_POLL_INTERVAL_MS,
  });
}
