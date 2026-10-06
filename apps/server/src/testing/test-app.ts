// Test helpers: build an app wired to a throwaway temp-dir DB.
// Excluded from the production build (see tsconfig.build.json).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import { type Db, createDb, runMigrations } from '../db/client.js';
import { seedSettings } from '../settings.js';

export function makeTestConfig(dataDir: string, overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    dataDir,
    openrouterApiKey: 'sk-or-test-secret',
    nodeEnv: 'test',
    logLevel: 'silent',
    defaultChatModel: 'test/chat-model',
    defaultEmbeddingModel: 'test/embed-model',
    transcriptConcurrency: 1,
    transcriptDelayMinMs: 1000,
    transcriptDelayMaxMs: 3000,
    transcriptMaxRetries: 3,
    ...overrides,
  };
}

export interface TestApp {
  app: Express;
  db: Db;
  sqlite: Database.Database;
  config: Config;
  dataDir: string;
  cleanup: () => void;
}

export function makeTestApp(overrides: Partial<Config> = {}): TestApp {
  const dataDir = mkdtempSync(join(tmpdir(), 'tubescribe-test-'));
  const config = makeTestConfig(dataDir, overrides);
  const { db, sqlite } = createDb(dataDir);
  runMigrations(db);
  seedSettings(db, config);
  const app = createApp({ config, db });

  return {
    app,
    db,
    sqlite,
    config,
    dataDir,
    cleanup: () => {
      sqlite.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
