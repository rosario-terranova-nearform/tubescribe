// /api/jobs/* — list, detail, and cancel.
import { z } from 'zod';
import { JobItemSchema, JobKindSchema, JobSchema, JobStatusSchema } from '../domain.js';

export const ListJobsQuerySchema = z
  .object({
    status: JobStatusSchema.optional(),
    kind: JobKindSchema.optional(),
    sourceId: z.string().min(1).optional(),
  })
  .strict();
export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

export const ListJobsResponseSchema = z
  .object({
    jobs: z.array(JobSchema),
  })
  .strict();
export type ListJobsResponse = z.infer<typeof ListJobsResponseSchema>;

export const GetJobResponseSchema = z
  .object({
    job: JobSchema,
    items: z.array(JobItemSchema).optional(),
  })
  .strict();
export type GetJobResponse = z.infer<typeof GetJobResponseSchema>;

export const CancelJobResponseSchema = z
  .object({
    job: JobSchema,
  })
  .strict();
export type CancelJobResponse = z.infer<typeof CancelJobResponseSchema>;
