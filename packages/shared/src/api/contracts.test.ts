// Schema round-trip tests for the API contracts.
// One file covering every endpoint group keeps the test count obvious at a
// glance and means there is exactly one place to look when a contract
// changes.

import { describe, expect, it } from 'vitest';
import {
  CancelJobResponseSchema,
  CreateBotRequestSchema,
  CreateBotResponseSchema,
  CreateChatRequestSchema,
  CreateChatResponseSchema,
  CreateSourceRequestSchema,
  CreateSourceResponseSchema,
  DeleteBotResponseSchema,
  DeleteChatResponseSchema,
  DeleteSourceResponseSchema,
  GetBotResponseSchema,
  GetChatResponseSchema,
  GetJobResponseSchema,
  GetSettingsResponseSchema,
  GetSourceResponseSchema,
  ListBotsResponseSchema,
  ListChatsResponseSchema,
  ListJobsQuerySchema,
  ListJobsResponseSchema,
  ListModelsResponseSchema,
  ListSourceVideosResponseSchema,
  ListSourcesResponseSchema,
  ModelSchema,
  ReextractSourceResponseSchema,
  ReindexSourceResponseSchema,
  ResolveSourceRequestSchema,
  ResolveSourceResponseSchema,
  SendMessageChunkSchema,
  SendMessageRequestSchema,
  UpdateBotRequestSchema,
  UpdateBotResponseSchema,
  UpdateSettingsRequestSchema,
  UpdateSettingsResponseSchema,
  UpdateSourceRequestSchema,
  UpdateSourceResponseSchema,
} from './index.js';

const NOW = '2025-01-01T00:00:00Z';
const TYPE_FILTER = { uploads: true, shorts: false, live: false };

const SOURCE = {
  id: 'src_1',
  kind: 'channel',
  identifier: 'UCabcdefghijklmnopqrstuv',
  title: 'MKBHD',
  thumbnailUrl: null,
  channelId: 'UCabcdefghijklmnopqrstuv',
  channelTitle: 'MKBHD',
  videoCount: 1234,
  typeFilter: TYPE_FILTER,
  createdAt: NOW,
} as const;

const JOB = {
  id: 'job_1',
  kind: 'extract',
  sourceId: 'src_1',
  status: 'running',
  startedAt: NOW,
  finishedAt: null,
  totalItems: 100,
  processedItems: 0,
  failedItems: 0,
} as const;

const BOT = {
  id: 'bot_1',
  name: 'philo',
  systemPrompt: 'You answer like a philosopher.',
  model: 'openai/gpt-4o-mini',
  sourceIds: ['src_1'],
  createdAt: NOW,
  updatedAt: NOW,
} as const;

function expectRoundTrip(
  schema: { parse: (v: unknown) => unknown },
  value: unknown,
  expected: unknown,
): void {
  const parsed = schema.parse(value);
  expect(parsed).toEqual(expected);
  const re = schema.parse(JSON.parse(JSON.stringify(parsed)));
  expect(re).toEqual(expected);
}

describe('resolve-source contract', () => {
  it('request requires non-empty input', () => {
    expect(() => ResolveSourceRequestSchema.parse({ input: '' })).toThrow();
    expect(ResolveSourceRequestSchema.parse({ input: '@mkbhd' })).toEqual({ input: '@mkbhd' });
  });

  it('response round-trips with nullable metadata', () => {
    const v = {
      suggestion: {
        kind: 'channel',
        identifier: '@mkbhd',
        title: 'MKBHD',
        thumbnailUrl: null,
        channelTitle: 'MKBHD',
        videoCount: null,
      },
    };
    expectRoundTrip(ResolveSourceResponseSchema, v, v);
  });
});

describe('sources contract', () => {
  it('create request requires kind+identifier', () => {
    expect(CreateSourceRequestSchema.parse({ kind: 'channel', identifier: '@mkbhd' })).toEqual({
      kind: 'channel',
      identifier: '@mkbhd',
    });
    expect(() => CreateSourceRequestSchema.parse({ kind: 'channel' })).toThrow();
  });

  it('create response round-trips source + job', () => {
    const v = { source: SOURCE, job: JOB };
    expectRoundTrip(CreateSourceResponseSchema, v, v);
  });

  it('list/get responses round-trip', () => {
    expectRoundTrip(ListSourcesResponseSchema, { sources: [SOURCE] }, { sources: [SOURCE] });
    expectRoundTrip(GetSourceResponseSchema, { source: SOURCE }, { source: SOURCE });
  });

  it('update request allows partial typeFilter', () => {
    expect(
      UpdateSourceRequestSchema.parse({
        typeFilter: { uploads: false, shorts: true, live: true },
      }),
    ).toEqual({ typeFilter: { uploads: false, shorts: true, live: true } });
  });

  it('update response is identical to get response', () => {
    expect(UpdateSourceResponseSchema).toBe(GetSourceResponseSchema);
  });

  it('delete response is { ok: true }', () => {
    expect(DeleteSourceResponseSchema.parse({ ok: true })).toEqual({ ok: true });
  });

  it('list videos', () => {
    const v = {
      videos: [
        {
          id: 'abcdefghijk',
          sourceId: 'src_1',
          title: 'Hello',
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          publishedAt: NOW,
          durationS: 360,
          language: 'en',
          captionKind: 'manual',
          engine: 'youtubei.js',
          status: 'fetched',
          error: null,
          fetchedAt: NOW,
          embeddedAt: null,
        },
      ],
    };
    expectRoundTrip(ListSourceVideosResponseSchema, v, v);
  });

  it('re-extract and re-index responses wrap a job', () => {
    expectRoundTrip(ReextractSourceResponseSchema, { job: JOB }, { job: JOB });
    expectRoundTrip(ReindexSourceResponseSchema, { job: JOB }, { job: JOB });
  });
});

describe('jobs contract', () => {
  it('list query allows optional filters', () => {
    expect(ListJobsQuerySchema.parse({})).toEqual({});
    expect(ListJobsQuerySchema.parse({ status: 'running' })).toEqual({ status: 'running' });
    expect(ListJobsQuerySchema.parse({ kind: 'embed', sourceId: 'src_1' })).toEqual({
      kind: 'embed',
      sourceId: 'src_1',
    });
    expect(() => ListJobsQuerySchema.parse({ status: 'NOPE' })).toThrow();
  });

  it('list response round-trips', () => {
    expectRoundTrip(ListJobsResponseSchema, { jobs: [JOB] }, { jobs: [JOB] });
  });

  it('get response supports items array', () => {
    const v = {
      job: JOB,
      items: [
        {
          id: 'ji_1',
          jobId: 'job_1',
          videoId: 'abcdefghijk',
          status: 'succeeded',
          startedAt: NOW,
          finishedAt: NOW,
          error: null,
        },
      ],
    };
    expectRoundTrip(GetJobResponseSchema, v, v);
  });

  it('cancel response wraps job', () => {
    expectRoundTrip(CancelJobResponseSchema, { job: JOB }, { job: JOB });
  });
});

describe('bots contract', () => {
  it('create requires name+model, defaults systemPrompt and sourceIds', () => {
    const parsed = CreateBotRequestSchema.parse({ name: 'philo', model: 'openai/gpt-4o-mini' });
    expect(parsed.systemPrompt).toBe('');
    expect(parsed.sourceIds).toEqual([]);
  });

  it('list/get/create/update wrapping a bot round-trip', () => {
    expectRoundTrip(CreateBotResponseSchema, { bot: BOT }, { bot: BOT });
    expectRoundTrip(ListBotsResponseSchema, { bots: [BOT] }, { bots: [BOT] });
    expectRoundTrip(GetBotResponseSchema, { bot: BOT }, { bot: BOT });
    expectRoundTrip(UpdateBotResponseSchema, { bot: BOT }, { bot: BOT });
  });

  it('update request is partial; defaults are applied to omitted fields too', () => {
    expect(UpdateBotRequestSchema.parse({ name: 'new' })).toEqual({
      name: 'new',
      systemPrompt: '',
      sourceIds: [],
    });
    expect(() => UpdateBotRequestSchema.parse({ name: 42 })).toThrow();
  });

  it('delete response', () => {
    expectRoundTrip(DeleteBotResponseSchema, { ok: true }, { ok: true });
  });
});

describe('models contract', () => {
  it('ModelSchema round-trips', () => {
    const v = {
      id: 'openai/gpt-4o-mini',
      name: 'OpenAI: GPT-4o mini',
      contextLength: 128000,
      pricingPromptPer1k: 0.00015,
      pricingCompletionPer1k: 0.0006,
    };
    expectRoundTrip(ModelSchema, v, v);
  });

  it('list response allows null pricing/context', () => {
    const v = {
      models: [
        {
          id: 'm1',
          name: 'm1',
          contextLength: null,
          pricingPromptPer1k: null,
          pricingCompletionPer1k: null,
        },
      ],
    };
    expectRoundTrip(ListModelsResponseSchema, v, v);
  });
});

describe('chats contract', () => {
  it('create request allows optional title', () => {
    expect(CreateChatRequestSchema.parse({})).toEqual({});
    expect(CreateChatRequestSchema.parse({ title: 'Hi' })).toEqual({ title: 'Hi' });
  });

  it('create response wraps chat', () => {
    const chat = {
      id: 'chat_1',
      botId: 'bot_1',
      title: 'Hi',
      createdAt: NOW,
      updatedAt: NOW,
    };
    expectRoundTrip(CreateChatResponseSchema, { chat }, { chat });
    expectRoundTrip(ListChatsResponseSchema, { chats: [chat] }, { chats: [chat] });
  });

  it('get chat + messages round-trips', () => {
    const v = {
      chat: {
        id: 'chat_1',
        botId: 'bot_1',
        title: 'Hi',
        createdAt: NOW,
        updatedAt: NOW,
      },
      messages: [
        {
          id: 'msg_1',
          chatId: 'chat_1',
          role: 'user',
          content: 'Hello',
          createdAt: NOW,
        },
      ],
    };
    expectRoundTrip(GetChatResponseSchema, v, v);
  });

  it('delete response', () => {
    expectRoundTrip(DeleteChatResponseSchema, { ok: true }, { ok: true });
  });

  it('send message request requires non-empty content', () => {
    expect(() => SendMessageRequestSchema.parse({ content: '' })).toThrow();
    expect(SendMessageRequestSchema.parse({ content: 'hi' })).toEqual({ content: 'hi' });
  });

  it('send message chunk discriminated union accepts all four types', () => {
    expect(SendMessageChunkSchema.parse({ type: 'delta', content: 'hi' })).toEqual({
      type: 'delta',
      content: 'hi',
    });
    expect(
      SendMessageChunkSchema.parse({
        type: 'citations',
        citations: [
          {
            videoId: 'abcdefghijk',
            sourceId: 'src_1',
            title: 'Hello',
            startMs: 0,
            endMs: 1000,
            text: '...',
          },
        ],
      }),
    ).toBeTruthy();
    expect(SendMessageChunkSchema.parse({ type: 'done', messageId: 'msg_1' })).toEqual({
      type: 'done',
      messageId: 'msg_1',
    });
    expect(SendMessageChunkSchema.parse({ type: 'error', message: 'boom' })).toEqual({
      type: 'error',
      message: 'boom',
    });
    expect(() => SendMessageChunkSchema.parse({ type: 'mystery' })).toThrow();
  });
});

describe('settings contract', () => {
  it('get response round-trips', () => {
    const v = {
      settings: {
        defaultChatModel: 'openai/gpt-4o-mini',
        defaultEmbeddingModel: 'openai/text-embedding-3-small',
        youtubeRequestDelayMsMin: 1000,
        youtubeRequestDelayMsMax: 3000,
        transcriptFetchConcurrency: 1,
      },
    };
    expectRoundTrip(GetSettingsResponseSchema, v, v);
  });

  it('update is partial and round-trips', () => {
    expectRoundTrip(
      UpdateSettingsRequestSchema,
      { defaultChatModel: 'anthropic/claude-3-haiku' },
      { defaultChatModel: 'anthropic/claude-3-haiku' },
    );

    const settingsNull = {
      defaultChatModel: null,
      defaultEmbeddingModel: null,
      youtubeRequestDelayMsMin: 1000,
      youtubeRequestDelayMsMax: 3000,
      transcriptFetchConcurrency: 1,
    };
    expectRoundTrip(
      UpdateSettingsResponseSchema,
      { settings: settingsNull },
      {
        settings: settingsNull,
      },
    );
  });
});
