// Query hook for the server-proxied OpenRouter model catalog (task 11).
import { useQuery } from '@tanstack/react-query';
import { ListModelsResponseSchema } from '@tubescribe/shared';
import { apiFetch } from './client.ts';

/** Matches the server's 1 h in-memory catalog cache (see MODELS_CACHE_TTL_MS). */
export const MODELS_STALE_TIME_MS = 60 * 60 * 1000;

export type ModelType = 'chat' | 'embedding';

export const modelsQueryKey = (type: ModelType = 'chat') => ['models', type] as const;

/**
 * Model catalog for ModelPicker (`type` selects the chat or embedding
 * catalog). `enabled` lets the picker defer the fetch until it is opened; the
 * 1 h stale/gc time mirrors the server cache, so the catalog is fetched at
 * most once per hour per session.
 */
export function useModels(options: { enabled?: boolean; type?: ModelType } = {}) {
  const type = options.type ?? 'chat';
  return useQuery({
    queryKey: modelsQueryKey(type),
    queryFn: ({ signal }) =>
      apiFetch(ListModelsResponseSchema, type === 'chat' ? '/models' : `/models?type=${type}`, {
        signal,
      }),
    staleTime: MODELS_STALE_TIME_MS,
    gcTime: MODELS_STALE_TIME_MS,
    enabled: options.enabled ?? true,
  });
}
