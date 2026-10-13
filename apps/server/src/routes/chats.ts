// Chats REST API (task 08): per-bot chat CRUD + message listing. The
// streaming message endpoint lives in ../chat.ts.

import { randomUUID } from 'node:crypto';
import {
  CreateChatRequestSchema,
  CreateChatResponseSchema,
  DeleteChatResponseSchema,
  GetChatResponseSchema,
  ListChatsResponseSchema,
} from '@tubescribe/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Express } from 'express';
import type { Db } from '../db/client.js';
import { bots, chats, messages } from '../db/schema.js';
import { HttpError } from '../http-error.js';

export const DEFAULT_CHAT_TITLE = 'New chat';

function getBotOr404(db: Db, id: string): void {
  const bot = db.select({ id: bots.id }).from(bots).where(eq(bots.id, id)).get();
  if (!bot) throw new HttpError(404, 'NOT_FOUND', `bot not found: ${id}`);
}

export function getChatOr404(db: Db, id: string): typeof chats.$inferSelect {
  const chat = db.select().from(chats).where(eq(chats.id, id)).get();
  if (!chat) throw new HttpError(404, 'NOT_FOUND', `chat not found: ${id}`);
  return chat;
}

/** Messages in insertion order; null citations become an absent field. */
export function listMessages(db: Db, chatId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(sql`${messages}.rowid`))
    .all()
    .map((m) => ({ ...m, citations: m.citations ?? undefined }));
}

export function registerChatsRoutes(app: Express, db: Db): void {
  app.get('/api/bots/:botId/chats', (req, res) => {
    getBotOr404(db, req.params.botId);
    const rows = db
      .select()
      .from(chats)
      .where(eq(chats.botId, req.params.botId))
      .orderBy(desc(chats.updatedAt))
      .all();
    res.json(ListChatsResponseSchema.parse({ chats: rows }));
  });

  app.post('/api/bots/:botId/chats', (req, res) => {
    const body = CreateChatRequestSchema.parse(req.body ?? {});
    getBotOr404(db, req.params.botId);
    const now = new Date().toISOString();
    const chat = {
      id: randomUUID(),
      botId: req.params.botId,
      title: body.title ?? DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(chats).values(chat).run();
    res.status(201).json(CreateChatResponseSchema.parse({ chat }));
  });

  app.get('/api/chats/:id', (req, res) => {
    const chat = getChatOr404(db, req.params.id);
    res.json(GetChatResponseSchema.parse({ chat, messages: listMessages(db, chat.id) }));
  });

  app.delete('/api/chats/:id', (req, res) => {
    const chat = getChatOr404(db, req.params.id);
    // FK cascade removes the chat's messages.
    db.delete(chats).where(eq(chats.id, chat.id)).run();
    res.json(DeleteChatResponseSchema.parse({ ok: true }));
  });
}
