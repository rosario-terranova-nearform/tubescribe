// Test helpers: a throwaway temp-dir DB (no HTTP app).
// Excluded from the production build (see tsconfig.build.json).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TYPE_FILTER } from '@tubescribe/shared';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { type Db, createDb, runMigrations } from '../db/client.js';
import { sources } from '../db/schema.js';
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

export interface TestDb {
  db: Db;
  sqlite: Database.Database;
  config: Config;
  dataDir: string;
  cleanup: () => void;
}

export function makeTestDb(overrides: Partial<Config> = {}): TestDb {
  const dataDir = mkdtempSync(join(tmpdir(), 'tubescribe-test-'));
  const config = makeTestConfig(dataDir, overrides);
  const { db, sqlite } = createDb(dataDir);
  runMigrations(db);
  seedSettings(db, config);

  return {
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

/** Insert a minimal source row (jobs/videos reference it via FK). */
export function seedSource(db: Db, overrides: Partial<typeof sources.$inferInsert> = {}): string {
  const id = overrides.id ?? 'source-test';
  db.insert(sources)
    .values({
      id,
      kind: 'channel',
      identifier: `UC-${id}`,
      title: `Source ${id}`,
      typeFilter: DEFAULT_TYPE_FILTER,
      createdAt: new Date().toISOString(),
      ...overrides,
    })
    .run();
  return id;
}
