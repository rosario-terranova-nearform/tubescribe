// @tubescribe/shared API error schema
// Every server error response uses this shape so the web client can rely on
// a single parser. `code` is the machine string, `message` is the human
// string, `details` is an optional bag for field-level errors.

import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL',
  'VALIDATION',
  'UNPROCESSABLE',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorDetailsSchema = z
  .object({
    field: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();
export type ApiErrorDetails = z.infer<typeof ApiErrorDetailsSchema>;

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: ApiErrorCodeSchema,
      message: z.string().min(1),
      details: ApiErrorDetailsSchema.optional(),
    }),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiSuccessEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({ ok: z.literal(true), data });
