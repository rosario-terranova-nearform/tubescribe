// /api/settings — get/update persistent settings.
// `OPENROUTER_API_KEY` lives in server .env, not the DB, so it's never in
// this schema — only the `openrouterKeyConfigured` boolean is reported.
import { z } from 'zod';
import { SettingsSchema } from '../domain.js';

export const GetSettingsResponseSchema = z
  .object({
    settings: SettingsSchema,
    /** Whether the server has an OpenRouter key configured (never the key). */
    openrouterKeyConfigured: z.boolean(),
  })
  .strict();
export type GetSettingsResponse = z.infer<typeof GetSettingsResponseSchema>;

export const UpdateSettingsRequestSchema = SettingsSchema.partial().strict();
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

export const UpdateSettingsResponseSchema = GetSettingsResponseSchema;
export type UpdateSettingsResponse = z.infer<typeof UpdateSettingsResponseSchema>;
