import { ApiErrorSchema } from '@tubescribe/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { type TestApp, makeTestApp } from './testing/test-app.js';

describe('app', () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it('GET /api/health returns { ok: true }', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('unknown routes return 404 in the shared error shape', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/api/nope');

    expect(res.status).toBe(404);
    const parsed = ApiErrorSchema.parse(res.body);
    expect(parsed.error.code).toBe('NOT_FOUND');
  });
});
