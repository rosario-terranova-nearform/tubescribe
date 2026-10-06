// Settings persistence: key/value rows in the DB, seeded from env defaults on
// first boot. The OpenRouter API key never lives here (it stays .env-only).

import {
  DEFAULT_SETTINGS,
  type Settings,
  SettingsSchema,
  type UpdateSettingsRequest,
  validateSettings,
} from '@tubescribe/shared';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { settings as settingsTable } from './db/schema.js';
import { HttpError } from './http-error.js';

const SETTING_KEYS = [
  'defaultChatModel',
  'defaultEmbeddingModel',
  'youtubeRequestDelayMsMin',
  'youtubeRequestDelayMsMax',
  'transcriptFetchConcurrency',
] as const satisfies readonly (keyof Settings)[];

function defaultsFromConfig(config: Config): Settings {
  return {
    defaultChatModel: config.defaultChatModel,
    defaultEmbeddingModel: config.defaultEmbeddingModel,
    youtubeRequestDelayMsMin: config.transcriptDelayMinMs,
    youtubeRequestDelayMsMax: config.transcriptDelayMaxMs,
    transcriptFetchConcurrency: config.transcriptConcurrency,
  };
}

/** Insert env-derived defaults for keys that don't exist yet. Idempotent. */
export function seedSettings(db: Db, config: Config): void {
  const defaults = defaultsFromConfig(config);
  for (const key of SETTING_KEYS) {
    db.insert(settingsTable).values({ key, value: defaults[key] }).onConflictDoNothing().run();
  }
}

export function getSettings(db: Db): Settings {
  const rows = db.select().from(settingsTable).all();
  const stored = Object.fromEntries(
    rows
      .filter((r) => (SETTING_KEYS as readonly string[]).includes(r.key))
      .map((r) => [r.key, r.value]),
  );
  // Fall back to shared defaults for keys missing from the DB (e.g. unseeded).
  return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...stored });
}

export function updateSettings(db: Db, patch: UpdateSettingsRequest): Settings {
  const next: Settings = { ...getSettings(db), ...patch };
  const validationError = validateSettings(next);
  if (validationError) {
    throw new HttpError(400, 'VALIDATION', validationError, {
      field: 'youtubeRequestDelayMsMax',
      reason: validationError,
    });
  }
  for (const key of SETTING_KEYS) {
    if (patch[key] !== undefined) {
      db.insert(settingsTable)
        .values({ key, value: next[key] })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: next[key] } })
        .run();
    }
  }
  return next;
}
