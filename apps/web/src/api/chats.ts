// Query + mutation hooks for the chats API (task 12).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateChatRequest,
  CreateChatResponseSchema,
  DeleteChatResponseSchema,
  GetChatResponseSchema,
  ListChatsResponseSchema,
} from '@tubescribe/shared';
import { apiFetch } from './client.ts';

export const chatsQueryKey = (botId: string) => ['bots', botId, 'chats'] as const;
export const chatQueryKey = (chatId: string) => ['chats', chatId] as const;

/** Chats for a bot, newest first (server-ordered by updatedAt). */
export function useChats(botId: string) {
  return useQuery({
    queryKey: chatsQueryKey(botId),
    queryFn: ({ signal }) =>
      apiFetch(ListChatsResponseSchema, `/bots/${encodeURIComponent(botId)}/chats`, { signal }),
  });
}

/** One chat with its persisted messages (citations included). */
export function useChatMessages(chatId: string) {
  return useQuery({
    queryKey: chatQueryKey(chatId),
    queryFn: ({ signal }) =>
      apiFetch(GetChatResponseSchema, `/chats/${encodeURIComponent(chatId)}`, { signal }),
  });
}

function useInvalidateChats(botId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: chatsQueryKey(botId) });
  };
}

/** POST /api/bots/:botId/chats — creates an empty chat. */
export function useCreateChat(botId: string) {
  const invalidate = useInvalidateChats(botId);
  return useMutation({
    mutationFn: (request: CreateChatRequest = {}) =>
      apiFetch(CreateChatResponseSchema, `/bots/${encodeURIComponent(botId)}/chats`, {
        method: 'POST',
        body: request,
      }),
    onSuccess: invalidate,
  });
}

/** DELETE /api/chats/:chatId — removes the chat and its messages (FK cascade). */
export function useDeleteChat(botId: string) {
  const invalidate = useInvalidateChats(botId);
  return useMutation({
    mutationFn: (chatId: string) =>
      apiFetch(DeleteChatResponseSchema, `/chats/${encodeURIComponent(chatId)}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  });
}
