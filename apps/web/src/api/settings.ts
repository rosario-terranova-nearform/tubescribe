// Query + mutation hooks for GET/PUT /api/settings.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GetSettingsResponseSchema,
  type UpdateSettingsRequest,
  UpdateSettingsResponseSchema,
} from '@tubescribe/shared';
import { apiFetch } from './client.ts';

export const settingsQueryKey = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: ({ signal }) => apiFetch(GetSettingsResponseSchema, '/settings', { signal }),
  });
}

/** PUT /api/settings — partial update; the response replaces the cache. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateSettingsRequest) =>
      apiFetch(UpdateSettingsResponseSchema, '/settings', { method: 'PUT', body: request }),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsQueryKey, data);
    },
  });
}
