import { ApiErrorSchema, GetSettingsResponseSchema } from '@tubescribe/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { getSettings } from '../settings.js';
import { type TestApp, makeTestApp } from '../testing/test-app.js';

describe('/api/settings', () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it('GET returns settings seeded from env defaults on first boot', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/api/settings');

    expect(res.status).toBe(200);
    const { settings } = GetSettingsResponseSchema.parse(res.body);
    expect(settings).toEqual({
      defaultChatModel: 'test/chat-model',
      defaultEmbeddingModel: 'test/embed-model',
      youtubeRequestDelayMsMin: 1000,
      youtubeRequestDelayMsMax: 3000,
      transcriptFetchConcurrency: 1,
    });
  });

  it('never leaks the OpenRouter API key', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('sk-or-test-secret');
    expect(res.text.toLowerCase()).not.toContain('openrouter');
  });

  it('PUT updates a partial body and GET reflects it (round trip)', async () => {
    t = makeTestApp();

    const put = await request(t.app)
      .put('/api/settings')
      .send({ defaultChatModel: 'test/other-model', transcriptFetchConcurrency: 2 });

    expect(put.status).toBe(200);
    const { settings } = GetSettingsResponseSchema.parse(put.body);
    expect(settings.defaultChatModel).toBe('test/other-model');
    expect(settings.transcriptFetchConcurrency).toBe(2);
    // Untouched keys keep their seeded values.
    expect(settings.youtubeRequestDelayMsMin).toBe(1000);

    const get = await request(t.app).get('/api/settings');
    expect(GetSettingsResponseSchema.parse(get.body).settings).toEqual(settings);

    // Persisted in the DB, not just in memory.
    expect(getSettings(t.db)).toEqual(settings);
  });

  it('PUT rejects schema-invalid bodies with 400 VALIDATION', async () => {
    t = makeTestApp();

    for (const body of [
      { transcriptFetchConcurrency: 3 }, // max is 2
      { youtubeRequestDelayMsMin: -5 },
      { defaultChatModel: '' },
      { bogusKey: 1 }, // strict object: unknown key
    ]) {
      const res = await request(t.app).put('/api/settings').send(body);
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION');
    }

    // A valid JSON document of the wrong shape (array, not object).
    const res = await request(t.app)
      .put('/api/settings')
      .set('Content-Type', 'application/json')
      .send('[1, 2, 3]');
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION');
  });

  it('PUT rejects cross-field-invalid bodies (delayMax < delayMin)', async () => {
    t = makeTestApp();

    const res = await request(t.app)
      .put('/api/settings')
      .send({ youtubeRequestDelayMsMin: 5000, youtubeRequestDelayMsMax: 100 });

    expect(res.status).toBe(400);
    const parsed = ApiErrorSchema.parse(res.body);
    expect(parsed.error.code).toBe('VALIDATION');
    expect(parsed.error.details?.field).toBe('youtubeRequestDelayMsMax');

    // Nothing persisted.
    expect(getSettings(t.db).youtubeRequestDelayMsMax).toBe(3000);
  });

  it('PUT with malformed JSON returns 400 BAD_REQUEST', async () => {
    t = makeTestApp();

    const res = await request(t.app)
      .put('/api/settings')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('PUT with an empty body is a no-op', async () => {
    t = makeTestApp();

    const res = await request(t.app).put('/api/settings').send({});

    expect(res.status).toBe(200);
    expect(GetSettingsResponseSchema.parse(res.body).settings).toEqual(getSettings(t.db));
  });
});
