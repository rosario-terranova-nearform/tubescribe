// /api/bots/* — bots CRUD. Bots own their sources (M2M via sourceIds).
import { z } from 'zod';
import { BotSchema } from '../domain.js';

export const CreateBotRequestSchema = z
  .object({
    name: z.string().min(1),
    systemPrompt: z.string().default(''),
    modelOverride: z.string().min(1).nullable().default(null),
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

/**
 * True partial: omitted fields stay undefined (no defaults applied) so the
 * server can tell "absent" (leave unchanged) from "present" (update). In
 * particular `modelOverride: null` clears the override, and an omitted
 * `sourceIds` keeps the current attachments.
 */
export const UpdateBotRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    systemPrompt: z.string().optional(),
    modelOverride: z.string().min(1).nullable().optional(),
    sourceIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type UpdateBotRequest = z.infer<typeof UpdateBotRequestSchema>;

export const UpdateBotResponseSchema = BotResponseEnvelopeSchema;
export type UpdateBotResponse = z.infer<typeof UpdateBotResponseSchema>;

export const DeleteBotResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type DeleteBotResponse = z.infer<typeof DeleteBotResponseSchema>;
