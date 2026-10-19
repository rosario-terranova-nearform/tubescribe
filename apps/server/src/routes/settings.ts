import { GetSettingsResponseSchema, UpdateSettingsRequestSchema } from '@tubescribe/shared';
import type { Express } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { getSettings, updateSettings } from '../settings.js';

export function registerSettingsRoutes(
  app: Express,
  db: Db,
  config: Pick<Config, 'openrouterApiKey'>,
): void {
  // Only ever the boolean — the key itself stays server-side (.env).
  const openrouterKeyConfigured = Boolean(config.openrouterApiKey);

  app.get('/api/settings', (_req, res) => {
    res.json(
      GetSettingsResponseSchema.parse({ settings: getSettings(db), openrouterKeyConfigured }),
    );
  });

  app.put('/api/settings', (req, res) => {
    const body = UpdateSettingsRequestSchema.parse(req.body ?? {});
    res.json(
      GetSettingsResponseSchema.parse({
        settings: updateSettings(db, body),
        openrouterKeyConfigured,
      }),
    );
  });
}
