// /api/models — public OpenRouter model list (server-proxied; never expose the
// server's key). Schema mirrors the slice of OpenRouter's `/api/v1/models`
// payload that the bot form actually uses.
import { z } from 'zod';

export const ModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    contextLength: z.number().int().positive().nullable(),
    pricingPromptPer1k: z.number().nullable(),
    pricingCompletionPer1k: z.number().nullable(),
  })
  .strict();
export type Model = z.infer<typeof ModelSchema>;

export const ListModelsResponseSchema = z.object({ models: z.array(ModelSchema) }).strict();
export type ListModelsResponse = z.infer<typeof ListModelsResponseSchema>;
