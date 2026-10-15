// Query + mutation hooks for the sources API (task 10).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateSourceRequest,
  CreateSourceResponseSchema,
  DeleteSourceResponseSchema,
  GetSourceResponseSchema,
  ListSourceVideosResponseSchema,
  ListSourcesResponseSchema,
  ReextractSourceResponseSchema,
  ReindexSourceResponseSchema,
  type ResolveSourceRequest,
  ResolveSourceResponseSchema,
} from '@tubescribe/shared';
import { apiFetch } from './client.ts';
import { jobsQueryKey } from './jobs.ts';
import { JOB_POLL_INTERVAL_MS } from './query-client.ts';

export const sourcesQueryKey = ['sources'] as const;
export const sourceQueryKey = (id: string) => [...sourcesQueryKey, id] as const;
export const sourceVideosQueryKey = (id: string, limit: number) =>
  [...sourceQueryKey(id), 'videos', { limit }] as const;

interface PollOption {
  /** Poll at the job cadence (e.g. while a job for this source is active). */
  poll?: boolean;
}

function refetchInterval({ poll }: PollOption): number | false {
  return poll ? JOB_POLL_INTERVAL_MS : false;
}

export function useSources(options: PollOption = {}) {
  return useQuery({
    queryKey: sourcesQueryKey,
    queryFn: ({ signal }) => apiFetch(ListSourcesResponseSchema, '/sources', { signal }),
    refetchInterval: refetchInterval(options),
  });
}

export function useSource(id: string, options: PollOption = {}) {
  return useQuery({
    queryKey: sourceQueryKey(id),
    queryFn: ({ signal }) =>
      apiFetch(GetSourceResponseSchema, `/sources/${encodeURIComponent(id)}`, { signal }),
    refetchInterval: refetchInterval(options),
  });
}

export function useSourceVideos(id: string, limit: number, options: PollOption = {}) {
  return useQuery({
    queryKey: sourceVideosQueryKey(id, limit),
    queryFn: ({ signal }) =>
      apiFetch(
        ListSourceVideosResponseSchema,
        `/sources/${encodeURIComponent(id)}/videos?limit=${limit}`,
        { signal },
      ),
    refetchInterval: refetchInterval(options),
  });
}

/** POST /api/sources/resolve — the smart-paste pre-flight behind AddSourceBox. */
export function useResolveSource() {
  return useMutation({
    mutationFn: (input: string) =>
      apiFetch(ResolveSourceResponseSchema, '/sources/resolve', {
        method: 'POST',
        body: { input } satisfies ResolveSourceRequest,
      }),
  });
}

/** Refreshes everything job/extraction affects: sources (+ details/videos) and jobs. */
function useInvalidateCorpus() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: sourcesQueryKey });
    queryClient.invalidateQueries({ queryKey: jobsQueryKey });
  };
}

/** POST /api/sources — creates the source and auto-starts its extraction job. */
export function useCreateSource() {
  const invalidate = useInvalidateCorpus();
  return useMutation({
    mutationFn: (request: CreateSourceRequest) =>
      apiFetch(CreateSourceResponseSchema, '/sources', { method: 'POST', body: request }),
    onSuccess: invalidate,
  });
}

/** POST /api/sources/:id/reextract — re-extracts failed videos only. */
export function useReextractSource(sourceId: string) {
  const invalidate = useInvalidateCorpus();
  return useMutation({
    mutationFn: () =>
      apiFetch(
        ReextractSourceResponseSchema,
        `/sources/${encodeURIComponent(sourceId)}/reextract`,
        {
          method: 'POST',
        },
      ),
    onSuccess: invalidate,
  });
}

/** POST /api/sources/:id/reindex — rebuilds the source's embedding chunks. */
export function useReindexSource(sourceId: string) {
  const invalidate = useInvalidateCorpus();
  return useMutation({
    mutationFn: () =>
      apiFetch(ReindexSourceResponseSchema, `/sources/${encodeURIComponent(sourceId)}/reindex`, {
        method: 'POST',
      }),
    onSuccess: invalidate,
  });
}

/** DELETE /api/sources/:id — removes the source, its videos, transcripts and chunks. */
export function useDeleteSource(sourceId: string) {
  const invalidate = useInvalidateCorpus();
  return useMutation({
    mutationFn: () =>
      apiFetch(DeleteSourceResponseSchema, `/sources/${encodeURIComponent(sourceId)}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  });
}
