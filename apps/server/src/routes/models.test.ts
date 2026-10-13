import { ApiErrorSchema, ListModelsResponseSchema } from '@tubescribe/shared';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TestApp, makeTestApp } from '../testing/test-app.js';

const CHAT_URL = 'https://openrouter.ai/api/v1/models';
const EMBEDDING_URL = 'https://openrouter.ai/api/v1/embeddings/models';

const CHAT_PAYLOAD = {
  data: [
    {
      id: 'openai/gpt-4o-mini',
      name: 'OpenAI: GPT-4o mini',
      context_length: 128000,
      // USD per token, as strings (the real payload shape).
      pricing: { prompt: '0.00000015', completion: '0.0000006' },
    },
    // Missing name/pricing/context still maps (name falls back to id).
    { id: 'bare/model' },
  ],
};

const EMBEDDING_PAYLOAD = {
  data: [{ id: 'openai/text-embedding-3-small', name: 'text-embedding-3-small' }],
};

interface FakeFetch {
  fn: typeof fetch;
  urls: string[];
}

/** fetch stub keyed by URL; records every call. */
function fakeFetch(payloads: Record<string, unknown>, status = 200): FakeFetch {
  const urls: string[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    urls.push(url);
    const payload = payloads[url];
    if (payload === undefined || status !== 200) return new Response('nope', { status });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return { fn, urls };
}

describe('/api/models', () => {
  let t: TestApp;
  afterEach(() => {
    vi.useRealTimers();
    t?.cleanup();
  });

  it('proxies and maps the chat model list (per-token → per-1k pricing)', async () => {
    const ff = fakeFetch({ [CHAT_URL]: CHAT_PAYLOAD });
    t = makeTestApp({}, { fetchFn: ff.fn });

    const res = await request(t.app).get('/api/models');

    expect(res.status).toBe(200);
    expect(ff.urls).toEqual([CHAT_URL]);
    const { models } = ListModelsResponseSchema.parse(res.body);
    expect(models).toEqual([
      {
        id: 'openai/gpt-4o-mini',
        name: 'OpenAI: GPT-4o mini',
        contextLength: 128000,
        pricingPromptPer1k: 0.00015,
        pricingCompletionPer1k: 0.0006,
      },
      {
        id: 'bare/model',
        name: 'bare/model',
        contextLength: null,
        pricingPromptPer1k: null,
        pricingCompletionPer1k: null,
      },
    ]);
  });

  it('?type=embedding serves the embeddings catalog', async () => {
    const ff = fakeFetch({ [EMBEDDING_URL]: EMBEDDING_PAYLOAD });
    t = makeTestApp({}, { fetchFn: ff.fn });

    const res = await request(t.app).get('/api/models?type=embedding');

    expect(res.status).toBe(200);
    expect(ff.urls).toEqual([EMBEDDING_URL]);
    expect(ListModelsResponseSchema.parse(res.body).models[0]?.id).toBe(
      'openai/text-embedding-3-small',
    );
  });

  it('caches each catalog for 1h in memory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    const ff = fakeFetch({ [CHAT_URL]: CHAT_PAYLOAD, [EMBEDDING_URL]: EMBEDDING_PAYLOAD });
    t = makeTestApp({}, { fetchFn: ff.fn });

    await request(t.app).get('/api/models');
    await request(t.app).get('/api/models');
    await request(t.app).get('/api/models?type=embedding');
    expect(ff.urls).toEqual([CHAT_URL, EMBEDDING_URL]); // second chat call hit the cache

    // 1h + 1ms later the cache has expired and upstream is fetched again.
    vi.setSystemTime(new Date('2026-10-13T01:00:00.001Z'));
    await request(t.app).get('/api/models');
    expect(ff.urls).toEqual([CHAT_URL, EMBEDDING_URL, CHAT_URL]);
  });

  it('upstream failures map to 502 UNPROCESSABLE', async () => {
    const down = fakeFetch({}, 500);
    t = makeTestApp({}, { fetchFn: down.fn });

    const res = await request(t.app).get('/api/models');

    expect(res.status).toBe(502);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('UNPROCESSABLE');
  });

  it('unexpected upstream payloads map to 502 UNPROCESSABLE', async () => {
    const weird = fakeFetch({ [CHAT_URL]: { data: [{ unexpected: true }] } });
    t = makeTestApp({}, { fetchFn: weird.fn });

    const res = await request(t.app).get('/api/models');

    expect(res.status).toBe(502);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('UNPROCESSABLE');
  });

  it('rejects unknown type values with 400 VALIDATION', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/api/models?type=bogus');

    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION');
  });

  it('never leaks the OpenRouter API key', async () => {
    const ff = fakeFetch({ [CHAT_URL]: CHAT_PAYLOAD });
    t = makeTestApp({}, { fetchFn: ff.fn });

    const res = await request(t.app).get('/api/models');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('sk-or-test-secret');
  });
});
