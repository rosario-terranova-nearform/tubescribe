import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type DbHandle, createDb, runMigrations } from './client.js';
import { sources } from './schema.js';

describe('db/client', () => {
  let dir: string;
  let handle: DbHandle | undefined;

  afterEach(() => {
    handle?.sqlite.close();
    handle = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  function freshDb(): DbHandle {
    // Nested path proves DATA_DIR is created recursively.
    dir = join(mkdtempSync(join(tmpdir(), 'tubescribe-db-')), 'nested', 'data');
    handle = createDb(dir);
    return handle;
  }

  it('creates DATA_DIR recursively and opens a WAL database with FKs on', () => {
    const { sqlite } = freshDb();

    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(sqlite.name).toBe(join(dir, 'tubescribe.db'));
  });

  it('migrates a fresh DB cleanly (all tables present, idempotent)', () => {
    const { db, sqlite } = freshDb();

    runMigrations(db);
    runMigrations(db); // second run is a no-op

    const tables = (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const table of [
      'sources',
      'videos',
      'jobs',
      'job_items',
      'bots',
      'bot_sources',
      'chats',
      'messages',
      'settings',
    ]) {
      expect(tables).toContain(table);
    }
  });

  it('round-trips a row (uuid default, JSON column, unique index)', () => {
    const { db, sqlite } = freshDb();
    runMigrations(db);

    const inserted = db
      .insert(sources)
      .values({
        kind: 'channel',
        identifier: '@example',
        title: 'Example channel',
        typeFilter: { uploads: true, shorts: false, live: false },
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();

    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.typeFilter).toEqual({ uploads: true, shorts: false, live: false });

    // Duplicate (kind, identifier) is rejected.
    expect(() =>
      db
        .insert(sources)
        .values({
          kind: 'channel',
          identifier: '@example',
          title: 'Dupe',
          typeFilter: { uploads: true, shorts: false, live: false },
          createdAt: new Date().toISOString(),
        })
        .run(),
    ).toThrow();

    // Foreign keys are enforced.
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO videos (id, source_id, title, url, duration_s, language) VALUES ('v1', 'missing', 't', 'u', 1, 'en')",
        )
        .run(),
    ).toThrow();
  });
});
