// Test helpers: build an app wired to a throwaway temp-dir DB.
// Excluded from the production build (see tsconfig.build.json).

import type { Express } from 'express';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { InnertubeFactory } from '../youtube/types.js';
import { type TestDb, makeTestDb } from './test-db.js';

export { makeTestConfig } from './test-db.js';

export interface TestAppDeps {
  youtube?: InnertubeFactory;
  worker?: { notify(): void };
}

export interface TestApp extends TestDb {
  app: Express;
}

/** Loud default: tests hitting youtube endpoints must inject a fake client. */
const noYoutube: InnertubeFactory = () =>
  Promise.reject(new Error('test app has no youtube client; inject a fake via makeTestApp deps'));

export function makeTestApp(overrides: Partial<Config> = {}, deps: TestAppDeps = {}): TestApp {
  const base = makeTestDb(overrides);
  const app = createApp({
    config: base.config,
    db: base.db,
    youtube: deps.youtube ?? noYoutube,
    worker: deps.worker,
  });
  return { ...base, app };
}
