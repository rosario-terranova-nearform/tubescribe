// /api/bots/* — bots CRUD. Bots own their sources (M2M via sourceIds).
import { z } from 'zod';
import { BotSchema } from '../domain.js';

export const CreateBotRequestSchema = z
  .object({
    name: z.string().min(1),
    systemPrompt: z.string().default(''),
    model: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type CreateBotRequest = z.infer<typeof CreateBotRequestSchema>;

export const BotResponseEnvelopeSchema = z.object({ bot: BotSchema }).strict();
export type BotResponseEnvelope = z.infer<typeof BotResponseEnvelopeSchema>;

export const CreateBotResponseSchema = BotResponseEnvelopeSchema;
export type CreateBotResponse = z.infer<typeof CreateBotResponseSchema>;

export const ListBotsResponseSchema = z.object({ bots: z.array(BotSchema) }).strict();
export type ListBotsResponse = z.infer<typeof ListBotsResponseSchema>;

export const GetBotResponseSchema = BotResponseEnvelopeSchema;
export type GetBotResponse = z.infer<typeof GetBotResponseSchema>;

export const UpdateBotRequestSchema = CreateBotRequestSchema.partial();
export type UpdateBotRequest = z.infer<typeof UpdateBotRequestSchema>;

export const UpdateBotResponseSchema = BotResponseEnvelopeSchema;
export type UpdateBotResponse = z.infer<typeof UpdateBotResponseSchema>;

export const DeleteBotResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type DeleteBotResponse = z.infer<typeof DeleteBotResponseSchema>;
