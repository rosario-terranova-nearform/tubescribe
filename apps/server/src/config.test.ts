import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults for an empty env', () => {
    const config = loadConfig({});

    expect(config.port).toBe(3001);
    expect(config.openrouterApiKey).toBeUndefined();
    expect(config.defaultChatModel).toBe('openai/gpt-4o-mini');
    expect(config.defaultEmbeddingModel).toBe('openai/text-embedding-3-small');
    expect(config.transcriptConcurrency).toBe(1);
    expect(config.transcriptDelayMinMs).toBe(1000);
    expect(config.transcriptDelayMaxMs).toBe(3000);
    expect(config.transcriptMaxRetries).toBe(3);
  });

  it('parses and coerces provided values', () => {
    const config = loadConfig({
      PORT: '4567',
      DATA_DIR: '/tmp/custom-data',
      OPENROUTER_API_KEY: 'sk-or-real',
      DEFAULT_CHAT_MODEL: 'anthropic/claude-sonnet',
      TRANSCRIPT_CONCURRENCY: '2',
      TRANSCRIPT_DELAY_MIN_MS: '500',
      TRANSCRIPT_DELAY_MAX_MS: '1500',
      TRANSCRIPT_MAX_RETRIES: '5',
    });

    expect(config.port).toBe(4567);
    expect(config.dataDir).toBe('/tmp/custom-data');
    expect(config.openrouterApiKey).toBe('sk-or-real');
    expect(config.defaultChatModel).toBe('anthropic/claude-sonnet');
    expect(config.transcriptConcurrency).toBe(2);
    expect(config.transcriptDelayMinMs).toBe(500);
    expect(config.transcriptDelayMaxMs).toBe(1500);
    expect(config.transcriptMaxRetries).toBe(5);
  });

  it('treats an empty OPENROUTER_API_KEY as unset', () => {
    expect(loadConfig({ OPENROUTER_API_KEY: '' }).openrouterApiKey).toBeUndefined();
    expect(loadConfig({ OPENROUTER_API_KEY: '   ' }).openrouterApiKey).toBeUndefined();
  });

  it('resolves a relative DATA_DIR against the repo root', () => {
    const config = loadConfig({ DATA_DIR: './data' });

    expect(isAbsolute(config.dataDir)).toBe(true);
    expect(config.dataDir.endsWith('/data')).toBe(true);
    expect(config.dataDir).not.toContain('apps/server');
  });

  it('throws on invalid values', () => {
    expect(() => loadConfig({ PORT: 'not-a-number' })).toThrow();
    expect(() => loadConfig({ PORT: '-1' })).toThrow();
    expect(() => loadConfig({ TRANSCRIPT_CONCURRENCY: '3' })).toThrow(); // max 2
    expect(() => loadConfig({ TRANSCRIPT_DELAY_MIN_MS: '0' })).toThrow(); // positive
    expect(() => loadConfig({ TRANSCRIPT_MAX_RETRIES: '-1' })).toThrow();
  });
});
