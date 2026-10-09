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

/** Aggregated video-status counts for a source (from the videos table). */
export const SourceStatusCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    fetched: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    embedded: z.number().int().nonnegative(),
  })
  .strict();
export type SourceStatusCounts = z.infer<typeof SourceStatusCountsSchema>;

/** Source row + aggregated status — what the sources list and detail render. */
export const SourceWithStatusSchema = SourceSchema.extend({ status: SourceStatusCountsSchema });
export type SourceWithStatus = z.infer<typeof SourceWithStatusSchema>;

export const ListSourcesResponseSchema = z
  .object({
    sources: z.array(SourceWithStatusSchema),
  })
  .strict();
export type ListSourcesResponse = z.infer<typeof ListSourcesResponseSchema>;

export const GetSourceResponseSchema = z
  .object({
    source: SourceWithStatusSchema,
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

/** Query params for GET /api/sources/:id/videos (offset pagination). */
export const ListSourceVideosQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(500).default(100),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();
export type ListSourceVideosQuery = z.infer<typeof ListSourceVideosQuerySchema>;

export const ListSourceVideosResponseSchema = z
  .object({
    videos: z.array(VideoSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export type ListSourceVideosResponse = z.infer<typeof ListSourceVideosResponseSchema>;

/** Query params for POST /api/sources/:id/reextract. */
export const ReextractSourceQuerySchema = z
  .object({
    /** 'true' re-extracts every video; omitted/'false' re-extracts failed only. */
    all: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ReextractSourceQuery = z.infer<typeof ReextractSourceQuerySchema>;

export const ReextractSourceResponseSchema = z.object({ job: JobSchema }).strict();
export type ReextractSourceResponse = z.infer<typeof ReextractSourceResponseSchema>;

export const ReindexSourceResponseSchema = z.object({ job: JobSchema }).strict();
export type ReindexSourceResponse = z.infer<typeof ReindexSourceResponseSchema>;
