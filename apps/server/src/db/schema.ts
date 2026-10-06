// Drizzle schema for the tubescribe SQLite database.
// Column shapes mirror the entity schemas in @tubescribe/shared (domain.ts):
// timestamps are ISO strings in text columns, JSON blobs use text({ mode: 'json' }).

import { randomUUID } from 'node:crypto';
import type {
  CaptionKind,
  Citation,
  Engine,
  JobItemStatus,
  JobKind,
  JobStatus,
  MessageRole,
  SourceKind,
  SourceTypeFilter,
  VideoStatus,
} from '@tubescribe/shared';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const sources = sqliteTable(
  'sources',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    kind: text('kind').$type<SourceKind>().notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    channelId: text('channel_id'),
    channelTitle: text('channel_title'),
    videoCount: integer('video_count'),
    typeFilter: text('type_filter', { mode: 'json' }).$type<SourceTypeFilter>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('sources_kind_identifier_key').on(t.kind, t.identifier)],
);

export const videos = sqliteTable(
  'videos',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url').notNull(),
    publishedAt: text('published_at'),
    durationS: real('duration_s').notNull(),
    language: text('language').notNull(),
    captionKind: text('caption_kind').$type<CaptionKind>(),
    engine: text('engine').$type<Engine>(),
    status: text('status').$type<VideoStatus>().notNull().default('pending'),
    error: text('error'),
    fetchedAt: text('fetched_at'),
    embeddedAt: text('embedded_at'),
  },
  (t) => [index('videos_source_id_idx').on(t.sourceId)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    kind: text('kind').$type<JobKind>().notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    status: text('status').$type<JobStatus>().notNull().default('queued'),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    totalItems: integer('total_items').notNull().default(0),
    processedItems: integer('processed_items').notNull().default(0),
    failedItems: integer('failed_items').notNull().default(0),
  },
  (t) => [index('jobs_source_id_idx').on(t.sourceId)],
);

export const jobItems = sqliteTable(
  'job_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    // No FK to videos on purpose: job history must survive video/source deletion.
    videoId: text('video_id').notNull(),
    status: text('status').$type<JobItemStatus>().notNull().default('pending'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    error: text('error'),
  },
  (t) => [index('job_items_job_id_idx').on(t.jobId)],
);

export const bots = sqliteTable('bots', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text('name').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const botSources = sqliteTable(
  'bot_sources',
  {
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.botId, t.sourceId] })],
);

export const chats = sqliteTable(
  'chats',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('chats_bot_id_idx').on(t.botId)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: text('role').$type<MessageRole>().notNull(),
    content: text('content').notNull(),
    citations: text('citations', { mode: 'json' }).$type<Citation[]>(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('messages_chat_id_idx').on(t.chatId)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});
