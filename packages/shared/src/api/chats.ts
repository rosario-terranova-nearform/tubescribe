// /api/chats/* — chat CRUD + streaming message endpoint.
// The streaming endpoint posts one NDJSON-encoded line per chunk. Each chunk
// has a `type` discriminator so the client can wire delta, citations, done,
// and error paths.
import { z } from 'zod';
import { ChatSchema, CitationSchema, MessageSchema } from '../domain.js';

export const CreateChatRequestSchema = z
  .object({
    title: z.string().optional(),
  })
  .strict();
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;

export const ChatEnvelopeSchema = z.object({ chat: ChatSchema }).strict();
export type ChatEnvelope = z.infer<typeof ChatEnvelopeSchema>;

export const CreateChatResponseSchema = ChatEnvelopeSchema;
export type CreateChatResponse = z.infer<typeof CreateChatResponseSchema>;

export const ListChatsResponseSchema = z.object({ chats: z.array(ChatSchema) }).strict();
export type ListChatsResponse = z.infer<typeof ListChatsResponseSchema>;

export const GetChatResponseSchema = z
  .object({
    chat: ChatSchema,
    messages: z.array(MessageSchema),
  })
  .strict();
export type GetChatResponse = z.infer<typeof GetChatResponseSchema>;

export const DeleteChatResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type DeleteChatResponse = z.infer<typeof DeleteChatResponseSchema>;

export const SendMessageRequestSchema = z
  .object({
    content: z.string().min(1),
  })
  .strict();
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const SendMessageChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), content: z.string() }).strict(),
  z.object({ type: z.literal('citations'), citations: z.array(CitationSchema) }).strict(),
  z.object({ type: z.literal('done'), messageId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('error'), message: z.string().min(1) }).strict(),
]);
export type SendMessageChunk = z.infer<typeof SendMessageChunkSchema>;
