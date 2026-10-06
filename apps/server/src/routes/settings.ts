import { GetSettingsResponseSchema, UpdateSettingsRequestSchema } from '@tubescribe/shared';
import type { Express } from 'express';
import type { Db } from '../db/client.js';
import { getSettings, updateSettings } from '../settings.js';

export function registerSettingsRoutes(app: Express, db: Db): void {
  app.get('/api/settings', (_req, res) => {
    res.json(GetSettingsResponseSchema.parse({ settings: getSettings(db) }));
  });

  app.put('/api/settings', (req, res) => {
    const body = UpdateSettingsRequestSchema.parse(req.body ?? {});
    res.json(GetSettingsResponseSchema.parse({ settings: updateSettings(db, body) }));
  });
}
