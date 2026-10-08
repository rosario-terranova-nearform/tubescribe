// Test helpers: build an app wired to a throwaway temp-dir DB.
// Excluded from the production build (see tsconfig.build.json).

import type { Express } from 'express';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import { type TestDb, makeTestDb } from './test-db.js';

export { makeTestConfig } from './test-db.js';

export interface TestApp extends TestDb {
  app: Express;
}

export function makeTestApp(overrides: Partial<Config> = {}): TestApp {
  const base = makeTestDb(overrides);
  const app = createApp({ config: base.config, db: base.db });
  return { ...base, app };
}
