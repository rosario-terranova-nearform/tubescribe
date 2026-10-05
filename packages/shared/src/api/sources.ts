// /api/sources/* — sources CRUD + per-source subresources.
// Adding a source auto-starts an extraction job; the create response includes
// both so the UI can render progress immediately.

import { z } from 'zod';
import {
  JobSchema,
  SourceInputSchema,
  SourceSchema,
  SourceTypeFilterSchema,
  VideoSchema,
} from '../domain.js';

export const CreateSourceRequestSchema = SourceInputSchema.extend({
  typeFilter: SourceTypeFilterSchema.optional(),
});
export type CreateSourceRequest = z.infer<typeof CreateSourceRequestSchema>;

export const CreateSourceResponseSchema = z
  .object({
    source: SourceSchema,
    job: JobSchema,
  })
  .strict();
export type CreateSourceResponse = z.infer<typeof CreateSourceResponseSchema>;

export const ListSourcesResponseSchema = z
  .object({
    sources: z.array(SourceSchema),
  })
  .strict();
export type ListSourcesResponse = z.infer<typeof ListSourcesResponseSchema>;

export const GetSourceResponseSchema = z
  .object({
    source: SourceSchema,
  })
  .strict();
export type GetSourceResponse = z.infer<typeof GetSourceResponseSchema>;

export const UpdateSourceRequestSchema = z
  .object({
    typeFilter: SourceTypeFilterSchema.optional(),
  })
  .strict();
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequestSchema>;

export const UpdateSourceResponseSchema = GetSourceResponseSchema;
export type UpdateSourceResponse = z.infer<typeof UpdateSourceResponseSchema>;

export const DeleteSourceResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();
export type DeleteSourceResponse = z.infer<typeof DeleteSourceResponseSchema>;

export const ListSourceVideosResponseSchema = z
  .object({
    videos: z.array(VideoSchema),
  })
  .strict();
export type ListSourceVideosResponse = z.infer<typeof ListSourceVideosResponseSchema>;

export const ReextractSourceResponseSchema = z.object({ job: JobSchema }).strict();
export type ReextractSourceResponse = z.infer<typeof ReextractSourceResponseSchema>;

export const ReindexSourceResponseSchema = z.object({ job: JobSchema }).strict();
export type ReindexSourceResponse = z.infer<typeof ReindexSourceResponseSchema>;
