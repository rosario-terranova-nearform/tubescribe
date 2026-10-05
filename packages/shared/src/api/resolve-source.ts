// POST /api/sources/resolve — the smart pre-flight.
// Body: a raw user-paste string. Response: a confirmed suggestion the UI
// shows on the confirm card before it POSTs to /api/sources.

import { z } from 'zod';
import { SourceInputSchema } from '../domain.js';

export const ResolveSourceRequestSchema = z
  .object({
    input: z.string().min(1),
  })
  .strict();
export type ResolveSourceRequest = z.infer<typeof ResolveSourceRequestSchema>;

export const ResolvedSourceSuggestionSchema = SourceInputSchema.extend({
  title: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  channelTitle: z.string().nullable(),
  videoCount: z.number().int().nonnegative().nullable(),
});
export type ResolvedSourceSuggestion = z.infer<typeof ResolvedSourceSuggestionSchema>;

export const ResolveSourceResponseSchema = z
  .object({
    suggestion: ResolvedSourceSuggestionSchema,
  })
  .strict();
export type ResolveSourceResponse = z.infer<typeof ResolveSourceResponseSchema>;
