// better-sqlite3 + Drizzle client. Creates DATA_DIR recursively, opens the DB
// at <DATA_DIR>/tubescribe.db in WAL mode with foreign keys on.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
}

export function createDb(dataDir: string): DbHandle {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(join(dataDir, 'tubescribe.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return { db: drizzle(sqlite, { schema }), sqlite };
}

// Resolved from this file so it works from src/db/ (tsx) and dist/db/ (node) alike.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Apply all pending drizzle-kit migrations. Idempotent. */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
