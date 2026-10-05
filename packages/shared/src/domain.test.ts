// Schema round-trip tests for the domain layer — confirms each entity can be
// parsed, JSON-serialized, re-parsed, and matches both schema instance and
// inferred type.

import { describe, expect, it } from 'vitest';
import {
  BotSchema,
  ChatSchema,
  CitationSchema,
  DEFAULT_SETTINGS,
  DEFAULT_TYPE_FILTER,
  JobItemSchema,
  JobSchema,
  MessageSchema,
  SettingsSchema,
  SourceKindSchema,
  SourceSchema,
  SourceTypeFilterSchema,
  VideoSchema,
  validateSettings,
} from './domain.js';

// Helpers to round-trip a value through the schema then JSON then the schema.
function throughJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// `.parse()` narrows to its inferred type; passing values through JSON and
// back round-trip dates as strings (which is exactly what we want).
function expectRoundTrip(
  schema: { parse: (v: unknown) => unknown },
  value: unknown,
  expected: unknown,
): void {
  const parsed = schema.parse(value);
  expect(parsed).toEqual(expected);
  const reParsed = schema.parse(throughJson(parsed));
  expect(reParsed).toEqual(expected);
}

describe('domain enums', () => {
  it('SourceKindSchema accepts the three kinds and rejects others', () => {
    expect(SourceKindSchema.parse('channel')).toBe('channel');
    expect(SourceKindSchema.parse('playlist')).toBe('playlist');
    expect(SourceKindSchema.parse('video')).toBe('video');
    expect(() => SourceKindSchema.parse('channelz')).toThrow();
  });

  it('SourceTypeFilterSchema is strict and rejects unknown flags', () => {
    expect(SourceTypeFilterSchema.parse(DEFAULT_TYPE_FILTER)).toEqual(DEFAULT_TYPE_FILTER);
    expect(() =>
      SourceTypeFilterSchema.parse({ uploads: true, shorts: false, live: false, trailer: true }),
    ).toThrow();
  });
});

describe('Source', () => {
  it('round-trips full object', () => {
    const v = {
      id: 'src_1',
      kind: 'channel' as const,
      identifier: 'UCabcdefghijklmnopqrstuv',
      title: 'MKBHD',
      thumbnailUrl: 'https://example.com/t.jpg',
      channelId: 'UCabcdefghijklmnopqrstuv',
      channelTitle: 'MKBHD',
      videoCount: 1234,
      typeFilter: { uploads: true, shorts: false, live: false },
      createdAt: '2025-01-01T00:00:00Z',
    };
    expectRoundTrip(SourceSchema, v, v);
  });

  it('nullable fields can be null', () => {
    const v = {
      id: 'src_1',
      kind: 'video' as const,
      identifier: 'abcdefghijk',
      title: 'Hello',
      thumbnailUrl: null,
      channelId: null,
      channelTitle: null,
      videoCount: null,
      typeFilter: { uploads: true, shorts: false, live: false },
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(SourceSchema.parse(v)).toEqual(v);
  });
});

describe('Video / Job', () => {
  it('VideoSchema round-trips', () => {
    const v = {
      id: 'abcdefghijk',
      sourceId: 'src_1',
      title: 'Hello',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      publishedAt: '2024-12-01T00:00:00Z',
      durationS: 360,
      language: 'en',
      captionKind: 'manual' as const,
      engine: 'youtubei.js' as const,
      status: 'fetched' as const,
      error: null,
      fetchedAt: '2024-12-02T00:00:00Z',
      embeddedAt: null,
    };
    expectRoundTrip(VideoSchema, v, v);
  });

  it('VideoSchema accepts null timestamps before fetch', () => {
    const v = {
      id: 'abcdefghijk',
      sourceId: 'src_1',
      title: 'Hi',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      publishedAt: null,
      durationS: 0,
      language: '',
      captionKind: null,
      engine: null,
      status: 'pending' as const,
      error: null,
      fetchedAt: null,
      embeddedAt: null,
    };
    expect(VideoSchema.parse(v)).toEqual(v);
  });

  it('JobSchema round-trips', () => {
    const v = {
      id: 'job_1',
      kind: 'extract' as const,
      sourceId: 'src_1',
      status: 'running' as const,
      startedAt: '2025-01-01T00:00:00Z',
      finishedAt: null,
      totalItems: 100,
      processedItems: 42,
      failedItems: 1,
    };
    expectRoundTrip(JobSchema, v, v);
  });

  it('JobItemSchema round-trips', () => {
    const v = {
      id: 'ji_1',
      jobId: 'job_1',
      videoId: 'abcdefghijk',
      status: 'succeeded' as const,
      startedAt: '2025-01-01T00:00:00Z',
      finishedAt: '2025-01-01T00:05:00Z',
      error: null,
    };
    expectRoundTrip(JobItemSchema, v, v);
  });
});

describe('Bot / Chat / Message', () => {
  it('BotSchema round-trips', () => {
    const v = {
      id: 'bot_1',
      name: 'philosophy bot',
      systemPrompt: 'You answer like a philosopher.',
      model: 'openai/gpt-4o-mini',
      sourceIds: ['src_1', 'src_2'],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    };
    expectRoundTrip(BotSchema, v, v);
  });

  it('ChatSchema round-trips', () => {
    const v = {
      id: 'chat_1',
      botId: 'bot_1',
      title: 'Hi',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };
    expectRoundTrip(ChatSchema, v, v);
  });

  it('MessageSchema round-trips with citations', () => {
    const v = {
      id: 'msg_1',
      chatId: 'chat_1',
      role: 'assistant' as const,
      content: 'See [1].',
      citations: [
        {
          videoId: 'abcdefghijk',
          sourceId: 'src_1',
          title: 'Hello',
          startMs: 120_000,
          endMs: 180_000,
          text: '...',
        },
      ],
      createdAt: '2025-01-01T00:00:00Z',
    };
    expectRoundTrip(MessageSchema, v, v);
  });

  it('CitationSchema rejects endMs < startMs', () => {
    const bad = {
      videoId: 'abcdefghijk',
      sourceId: 'src_1',
      title: 'Hello',
      startMs: 180_000,
      endMs: 120_000,
      text: '...',
    };
    expect(() => CitationSchema.parse(bad)).toThrow();
  });
});

describe('Settings', () => {
  it('DEFAULT_SETTINGS parses and matches the schema', () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects max < min delay via validateSettings; schema cannot carry the refine because partial() forbids it', () => {
    const bad = {
      ...DEFAULT_SETTINGS,
      youtubeRequestDelayMsMin: 3000,
      youtubeRequestDelayMsMax: 1000,
    };
    expect(validateSettings(bad)).not.toBeNull();
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull();
  });

  it('rejects concurrency > 2', () => {
    const bad = { ...DEFAULT_SETTINGS, transcriptFetchConcurrency: 3 };
    expect(() => SettingsSchema.parse(bad)).toThrow();
  });

  it('round-trips with null defaults', () => {
    const v = { ...DEFAULT_SETTINGS, defaultChatModel: null, defaultEmbeddingModel: null };
    expectRoundTrip(SettingsSchema, v, v);
  });
});
