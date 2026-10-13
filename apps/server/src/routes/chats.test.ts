import {
  ApiErrorSchema,
  CreateChatResponseSchema,
  GetChatResponseSchema,
  ListChatsResponseSchema,
} from '@tubescribe/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { bots, chats, messages } from '../db/schema.js';
import { type TestApp, makeTestApp } from '../testing/test-app.js';

function seedBot(db: Db, id: string): string {
  const now = new Date().toISOString();
  db.insert(bots)
    .values({
      id,
      name: id,
      systemPrompt: 'sp',
      modelOverride: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

describe('/api/chats', () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it('POST /api/bots/:botId/chats creates a chat (default title) with 201', async () => {
    t = makeTestApp();
    const botId = seedBot(t.db, 'bot-1');

    const res = await request(t.app).post(`/api/bots/${botId}/chats`).send({});

    expect(res.status).toBe(201);
    const { chat } = CreateChatResponseSchema.parse(res.body);
    expect(chat.botId).toBe(botId);
    expect(chat.title).toBe('New chat');

    const explicit = await request(t.app).post(`/api/bots/${botId}/chats`).send({ title: 'Hi' });
    expect(CreateChatResponseSchema.parse(explicit.body).chat.title).toBe('Hi');
  });

  it('POST 404s for an unknown bot and 400s on invalid bodies', async () => {
    t = makeTestApp();

    const missing = await request(t.app).post('/api/bots/nope/chats').send({});
    expect(missing.status).toBe(404);
    expect(ApiErrorSchema.parse(missing.body).error.code).toBe('NOT_FOUND');

    const botId = seedBot(t.db, 'bot-1');
    const bad = await request(t.app).post(`/api/bots/${botId}/chats`).send({ title: 42 });
    expect(bad.status).toBe(400);
    expect(ApiErrorSchema.parse(bad.body).error.code).toBe('VALIDATION');
  });

  it('GET /api/bots/:botId/chats lists only that bot’s chats', async () => {
    t = makeTestApp();
    const a = seedBot(t.db, 'bot-a');
    const b = seedBot(t.db, 'bot-b');
    await request(t.app).post(`/api/bots/${a}/chats`).send({ title: 'a1' });
    await request(t.app).post(`/api/bots/${a}/chats`).send({ title: 'a2' });
    await request(t.app).post(`/api/bots/${b}/chats`).send({ title: 'b1' });

    const res = await request(t.app).get(`/api/bots/${a}/chats`);

    expect(res.status).toBe(200);
    const { chats: list } = ListChatsResponseSchema.parse(res.body);
    expect(list.map((c) => c.title).sort()).toEqual(['a1', 'a2']);
    expect(list.every((c) => c.botId === a)).toBe(true);

    const missing = await request(t.app).get('/api/bots/nope/chats');
    expect(missing.status).toBe(404);
  });

  it('GET /api/chats/:id returns the chat with its messages in order', async () => {
    t = makeTestApp();
    const botId = seedBot(t.db, 'bot-1');
    const { chat } = CreateChatResponseSchema.parse(
      (await request(t.app).post(`/api/bots/${botId}/chats`).send({})).body,
    );
    const now = new Date().toISOString();
    t.db
      .insert(messages)
      .values([
        { id: 'm1', chatId: chat.id, role: 'user', content: 'hi', createdAt: now },
        {
          id: 'm2',
          chatId: chat.id,
          role: 'assistant',
          content: 'hello',
          citations: [
            {
              videoId: 'vid-1',
              sourceId: 'src-1',
              title: 'Title',
              startMs: 0,
              endMs: 1500,
              text: 'excerpt',
            },
          ],
          createdAt: now,
        },
      ])
      .run();

    const res = await request(t.app).get(`/api/chats/${chat.id}`);

    expect(res.status).toBe(200);
    const parsed = GetChatResponseSchema.parse(res.body);
    expect(parsed.chat.id).toBe(chat.id);
    expect(parsed.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    // Citations are stored on the assistant message; the user message has none.
    expect(parsed.messages[0]).not.toHaveProperty('citations');
    expect(parsed.messages[1]?.citations?.[0]).toMatchObject({ videoId: 'vid-1', startMs: 0 });
  });

  it('GET /api/chats/:id 404s on unknown chats', async () => {
    t = makeTestApp();

    const res = await request(t.app).get('/api/chats/nope');

    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('DELETE /api/chats/:id removes the chat and its messages', async () => {
    t = makeTestApp();
    const botId = seedBot(t.db, 'bot-1');
    const { chat } = CreateChatResponseSchema.parse(
      (await request(t.app).post(`/api/bots/${botId}/chats`).send({})).body,
    );
    t.db
      .insert(messages)
      .values({
        id: 'm1',
        chatId: chat.id,
        role: 'user',
        content: 'hi',
        createdAt: new Date().toISOString(),
      })
      .run();

    const res = await request(t.app).delete(`/api/chats/${chat.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(t.db.select().from(chats).all()).toHaveLength(0);
    expect(t.db.select().from(messages).all()).toHaveLength(0);

    const again = await request(t.app).delete(`/api/chats/${chat.id}`);
    expect(again.status).toBe(404);
  });
});
