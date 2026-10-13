// Bots REST API (task 08): CRUD with per-bot source attachments (M2M via
// bot_sources). `modelOverride` is nullable — null means the settings
// default chat model is resolved at chat time (see chat.ts).

import { randomUUID } from 'node:crypto';
import {
  type Bot,
  CreateBotRequestSchema,
  CreateBotResponseSchema,
  DeleteBotResponseSchema,
  GetBotResponseSchema,
  ListBotsResponseSchema,
  UpdateBotRequestSchema,
  UpdateBotResponseSchema,
} from '@tubescribe/shared';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Express } from 'express';
import type { Db } from '../db/client.js';
import { botSources, bots, sources } from '../db/schema.js';
import { HttpError } from '../http-error.js';

type BotRow = typeof bots.$inferSelect;

/** Bot row + attached sourceIds in insertion order (the shared Bot shape). */
function withSourceIds(db: Db, row: BotRow): Bot {
  const sourceIds = db
    .select({ sourceId: botSources.sourceId })
    .from(botSources)
    .where(eq(botSources.botId, row.id))
    .orderBy(asc(sql`${botSources}.rowid`))
    .all()
    .map((r) => r.sourceId);
  return { ...row, sourceIds };
}

function getBotOr404(db: Db, id: string): BotRow {
  const bot = db.select().from(bots).where(eq(bots.id, id)).get();
  if (!bot) throw new HttpError(404, 'NOT_FOUND', `bot not found: ${id}`);
  return bot;
}

/** Every attached sourceId must reference an existing source. */
function assertSourcesExist(db: Db, sourceIds: string[]): void {
  const unique = [...new Set(sourceIds)];
  if (unique.length === 0) return;
  const found = db
    .select({ id: sources.id })
    .from(sources)
    .where(inArray(sources.id, unique))
    .all();
  if (found.length !== unique.length) {
    throw new HttpError(400, 'VALIDATION', 'unknown source ids', {
      field: 'sourceIds',
      reason: 'every sourceId must reference an existing source',
    });
  }
}

function replaceSources(db: Db, botId: string, sourceIds: string[]): void {
  db.delete(botSources).where(eq(botSources.botId, botId)).run();
  for (const sourceId of [...new Set(sourceIds)]) {
    db.insert(botSources).values({ botId, sourceId }).run();
  }
}

export function registerBotsRoutes(app: Express, db: Db): void {
  app.post('/api/bots', (req, res) => {
    const body = CreateBotRequestSchema.parse(req.body ?? {});
    assertSourcesExist(db, body.sourceIds);
    const now = new Date().toISOString();
    const bot: BotRow = {
      id: randomUUID(),
      name: body.name,
      systemPrompt: body.systemPrompt,
      modelOverride: body.modelOverride,
      createdAt: now,
      updatedAt: now,
    };
    db.transaction((tx) => {
      tx.insert(bots).values(bot).run();
      replaceSources(tx, bot.id, body.sourceIds);
    });
    res.status(201).json(CreateBotResponseSchema.parse({ bot: withSourceIds(db, bot) }));
  });

  app.get('/api/bots', (_req, res) => {
    const rows = db.select().from(bots).orderBy(desc(bots.createdAt)).all();
    res.json(ListBotsResponseSchema.parse({ bots: rows.map((row) => withSourceIds(db, row)) }));
  });

  app.get('/api/bots/:id', (req, res) => {
    res.json(
      GetBotResponseSchema.parse({ bot: withSourceIds(db, getBotOr404(db, req.params.id)) }),
    );
  });

  /**
   * True-partial update: only fields present in the body change. In
   * particular `modelOverride: null` clears the override (settings default
   * applies again) and `sourceIds` replaces the whole attachment set.
   */
  app.put('/api/bots/:id', (req, res) => {
    const body = UpdateBotRequestSchema.parse(req.body ?? {});
    const existing = getBotOr404(db, req.params.id);
    if (body.sourceIds !== undefined) assertSourcesExist(db, body.sourceIds);
    db.transaction((tx) => {
      tx.update(bots)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
          ...(body.modelOverride !== undefined ? { modelOverride: body.modelOverride } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(bots.id, existing.id))
        .run();
      if (body.sourceIds !== undefined) replaceSources(tx, existing.id, body.sourceIds);
    });
    const updated = db.select().from(bots).where(eq(bots.id, existing.id)).get();
    res.json(UpdateBotResponseSchema.parse({ bot: withSourceIds(db, updated ?? existing) }));
  });

  app.delete('/api/bots/:id', (req, res) => {
    const bot = getBotOr404(db, req.params.id);
    // FK cascades remove bot_sources, chats and their messages.
    db.delete(bots).where(eq(bots.id, bot.id)).run();
    res.json(DeleteBotResponseSchema.parse({ ok: true }));
  });
}
