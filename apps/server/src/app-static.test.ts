// Prod static serving (task 14): with a webDist injected, the app serves the
// built web app and falls back to index.html for non-API GETs; /api keeps its
// JSON 404. Without it, every unknown route is the JSON 404 as before.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiErrorSchema } from '@tubescribe/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { type TestApp, makeTestApp } from './testing/test-app.js';

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';

function makeWebDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tubescribe-webdist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), INDEX_HTML);
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("hi");\n');
  return dir;
}

describe('static web serving', () => {
  let t: TestApp;
  let webDist: string | undefined;
  afterEach(() => {
    t?.cleanup();
    if (webDist) rmSync(webDist, { recursive: true, force: true });
    webDist = undefined;
  });

  it('serves index.html at / and for client-side routes', async () => {
    webDist = makeWebDist();
    t = makeTestApp({}, { webDist });

    for (const path of ['/', '/bots', '/bots/abc-123?chat=x']) {
      const res = await request(t.app).get(path);
      expect(res.status).toBe(200);
      expect(res.text).toBe(INDEX_HTML);
      expect(res.headers['content-type']).toContain('text/html');
    }
  });

  it('serves real static assets', async () => {
    webDist = makeWebDist();
    t = makeTestApp({}, { webDist });

    const res = await request(t.app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log("hi");\n');
  });

  it('keeps /api 404s in the shared JSON shape (no SPA fallback)', async () => {
    webDist = makeWebDist();
    t = makeTestApp({}, { webDist });

    for (const method of ['get', 'post'] as const) {
      const res = await request(t.app)[method]('/api/nope');
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
    }
  });

  it('404s non-API, non-GET unknowns rather than serving the SPA', async () => {
    webDist = makeWebDist();
    t = makeTestApp({}, { webDist });

    const res = await request(t.app).post('/definitely-not-a-page');
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('is disabled when webDist is null (test default)', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/');
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('is disabled when the directory has no index.html', async () => {
    webDist = mkdtempSync(join(tmpdir(), 'tubescribe-webdist-empty-'));
    t = makeTestApp({}, { webDist });

    const res = await request(t.app).get('/');
    expect(res.status).toBe(404);
  });
});
