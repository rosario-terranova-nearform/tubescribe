// Query + mutation hooks for the bots API (task 11).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateBotRequest,
  CreateBotResponseSchema,
  DeleteBotResponseSchema,
  GetBotResponseSchema,
  ListBotsResponseSchema,
  type UpdateBotRequest,
  UpdateBotResponseSchema,
} from '@tubescribe/shared';
import { apiFetch } from './client.ts';

export const botsQueryKey = ['bots'] as const;
export const botQueryKey = (id: string) => [...botsQueryKey, id] as const;

export function useBots() {
  return useQuery({
    queryKey: botsQueryKey,
    queryFn: ({ signal }) => apiFetch(ListBotsResponseSchema, '/bots', { signal }),
  });
}

export function useBot(id: string) {
  return useQuery({
    queryKey: botQueryKey(id),
    queryFn: ({ signal }) =>
      apiFetch(GetBotResponseSchema, `/bots/${encodeURIComponent(id)}`, { signal }),
  });
}

function useInvalidateBots() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: botsQueryKey });
  };
}

/** POST /api/bots — creates the bot and its source attachments. */
export function useCreateBot() {
  const invalidate = useInvalidateBots();
  return useMutation({
    mutationFn: (request: CreateBotRequest) =>
      apiFetch(CreateBotResponseSchema, '/bots', { method: 'POST', body: request }),
    onSuccess: invalidate,
  });
}

/**
 * PUT /api/bots/:id — BotForm sends the full field set; `modelOverride: null`
 * clears the override so the settings default applies again.
 */
export function useUpdateBot(id: string) {
  const invalidate = useInvalidateBots();
  return useMutation({
    mutationFn: (request: UpdateBotRequest) =>
      apiFetch(UpdateBotResponseSchema, `/bots/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: request,
      }),
    onSuccess: invalidate,
  });
}

/** DELETE /api/bots/:id — removes the bot, its attachments and chat history. */
export function useDeleteBot(id: string) {
  const invalidate = useInvalidateBots();
  return useMutation({
    mutationFn: () =>
      apiFetch(DeleteBotResponseSchema, `/bots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
