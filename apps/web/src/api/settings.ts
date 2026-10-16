// Query hook for GET /api/settings (ModelPicker labels the empty selection
// with the configured default chat model).
import { useQuery } from '@tanstack/react-query';
import { GetSettingsResponseSchema } from '@tubescribe/shared';
import { apiFetch } from './client.ts';

export const settingsQueryKey = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: ({ signal }) => apiFetch(GetSettingsResponseSchema, '/settings', { signal }),
  });
}
