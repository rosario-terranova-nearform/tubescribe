// @tubescribe/shared domain types
// Enums and entity shapes used by both server and web. Every entity is a zod
// schema so the type and the runtime validator stay in sync.

import { z } from 'zod';

// --- Enums -----------------------------------------------------------------

export const SourceKindSchema = z.enum(['channel', 'playlist', 'video']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const VideoStatusSchema = z.enum(['pending', 'fetched', 'failed', 'embedded']);
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobKindSchema = z.enum(['extract', 'embed']);
export type JobKind = z.infer<typeof JobKindSchema>;

export const CaptionKindSchema = z.enum(['manual', 'asr']);
export type CaptionKind = z.infer<typeof CaptionKindSchema>;

export const EngineSchema = z.enum([
  'youtubei.js',
  'youtubei.js-tv-embedded',
  'youtube-transcript',
]);
export type Engine = z.infer<typeof EngineSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

// --- Source ---------------------------------------------------------------

/**
 * Per-source type filter. Default: uploads on, shorts + live off (most users
 * want regular uploads; shorts often lack transcripts and live has none).
 */
export const DEFAULT_TYPE_FILTER = {
  uploads: true,
  shorts: false,
  live: false,
} as const satisfies SourceTypeFilter;

export const SourceTypeFilterSchema = z
  .object({
    uploads: z.boolean(),
    shorts: z.boolean(),
    live: z.boolean(),
  })
  .strict();
export type SourceTypeFilter = z.infer<typeof SourceTypeFilterSchema>;

export const SourceInputSchema = z
  .object({
    kind: SourceKindSchema,
    identifier: z.string().min(1),
  })
  .strict();
export type SourceInput = z.infer<typeof SourceInputSchema>;

export const SourceSchema = z
  .object({
    id: z.string().min(1),
    kind: SourceKindSchema,
    identifier: z.string().min(1),
    title: z.string(),
    thumbnailUrl: z.string().nullable(),
    channelId: z.string().nullable(),
    channelTitle: z.string().nullable(),
    videoCount: z.number().int().nonnegative().nullable(),
    typeFilter: SourceTypeFilterSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Source = z.infer<typeof SourceSchema>;

// --- Video ----------------------------------------------------------------

export const CITATION_MIN_RANGE_MS = 1;
const MAX_RANGE_MS = 24 * 60 * 60 * 1000;

export const CitationSchema = z
  .object({
    videoId: z.string().min(1),
    sourceId: z.string().min(1),
    title: z.string(),
    startMs: z.number().int().nonnegative().max(MAX_RANGE_MS),
    endMs: z.number().int().nonnegative().max(MAX_RANGE_MS),
    text: z.string(),
  })
  .strict()
  .refine((c) => c.endMs > c.startMs - CITATION_MIN_RANGE_MS, {
    message: 'endMs must be >= startMs',
    path: ['endMs'],
  });
export type Citation = z.infer<typeof CitationSchema>;

export const VideoSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    title: z.string(),
    url: z.string(),
    publishedAt: z.iso.datetime().nullable(),
    durationS: z.number().nonnegative(),
    language: z.string(),
    captionKind: CaptionKindSchema.nullable(),
    engine: EngineSchema.nullable(),
    status: VideoStatusSchema,
    error: z.string().nullable(),
    fetchedAt: z.iso.datetime().nullable(),
    embeddedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type Video = z.infer<typeof VideoSchema>;

// --- Job ------------------------------------------------------------------

export const JobItemStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed']);
export type JobItemStatus = z.infer<typeof JobItemStatusSchema>;

export const JobItemSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    videoId: z.string().min(1),
    status: JobItemStatusSchema,
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type JobItem = z.infer<typeof JobItemSchema>;

export const JobSchema = z
  .object({
    id: z.string().min(1),
    kind: JobKindSchema,
    sourceId: z.string().min(1),
    status: JobStatusSchema,
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    totalItems: z.number().int().nonnegative(),
    processedItems: z.number().int().nonnegative(),
    failedItems: z.number().int().nonnegative(),
  })
  .strict();
export type Job = z.infer<typeof JobSchema>;

// --- Bot / Chat / Message -------------------------------------------------

export const BotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    systemPrompt: z.string(),
    model: z.string().min(1),
    sourceIds: z.array(z.string().min(1)),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Bot = z.infer<typeof BotSchema>;

export const ChatSchema = z
  .object({
    id: z.string().min(1),
    botId: z.string().min(1),
    title: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Chat = z.infer<typeof ChatSchema>;

export const MessageSchema = z
  .object({
    id: z.string().min(1),
    chatId: z.string().min(1),
    role: MessageRoleSchema,
    content: z.string(),
    citations: z.array(CitationSchema).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;

// --- Settings -------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  defaultChatModel: 'openai/gpt-4o-mini',
  defaultEmbeddingModel: 'openai/text-embedding-3-small',
  youtubeRequestDelayMsMin: 1000,
  youtubeRequestDelayMsMax: 3000,
  transcriptFetchConcurrency: 1,
} as const satisfies Settings;

export const SettingsSchema = z
  .object({
    defaultChatModel: z.string().min(1).nullable(),
    defaultEmbeddingModel: z.string().min(1).nullable(),
    youtubeRequestDelayMsMin: z.number().int().positive(),
    youtubeRequestDelayMsMax: z.number().int().positive(),
    transcriptFetchConcurrency: z.number().int().positive().max(2),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Cross-field validation. `SettingsSchema` can't carry refinements because
 * zod v4 object schemas with `.partial()` forbid them on the underlying
 * schema, and we need a partial for the `PUT /api/settings` body. Call this
 * server-side before persisting.
 */
export function validateSettings(s: Settings): string | null {
  if (s.youtubeRequestDelayMsMax < s.youtubeRequestDelayMsMin) {
    return 'youtubeRequestDelayMsMax must be >= youtubeRequestDelayMsMin';
  }
  return null;
}
