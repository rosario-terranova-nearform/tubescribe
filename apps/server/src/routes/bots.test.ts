import {
  ApiErrorSchema,
  CreateBotResponseSchema,
  GetBotResponseSchema,
  ListBotsResponseSchema,
  UpdateBotResponseSchema,
} from '@tubescribe/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { botSources, bots, chats } from '../db/schema.js';
import { type TestApp, makeTestApp } from '../testing/test-app.js';
import { seedSource } from '../testing/test-db.js';

describe('/api/bots', () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  function createBot(body: Record<string, unknown> = { name: 'philo' }) {
    return request(t.app).post('/api/bots').send(body);
  }

  it('POST creates a bot with defaults (empty prompt, null override, no sources)', async () => {
    t = makeTestApp();

    const res = await createBot();

    expect(res.status).toBe(201);
    const { bot } = CreateBotResponseSchema.parse(res.body);
    expect(bot.name).toBe('philo');
    expect(bot.systemPrompt).toBe('');
    expect(bot.modelOverride).toBeNull();
    expect(bot.sourceIds).toEqual([]);
    expect(t.db.select().from(bots).all()).toHaveLength(1);
  });

  it('POST attaches sources (M2M) and they round-trip through GET', async () => {
    t = makeTestApp();
    const a = seedSource(t.db, { id: 'src-a' });
    const b = seedSource(t.db, { id: 'src-b' });

    const res = await createBot({
      name: 'duo',
      systemPrompt: 'sp',
      modelOverride: 'acme/pro',
      sourceIds: [a, b, a], // duplicates collapse
    });

    expect(res.status).toBe(201);
    const { bot } = CreateBotResponseSchema.parse(res.body);
    expect(bot.modelOverride).toBe('acme/pro');
    expect(bot.sourceIds).toEqual([a, b]);
    expect(t.db.select().from(botSources).where(eq(botSources.botId, bot.id)).all()).toHaveLength(
      2,
    );

    const get = await request(t.app).get(`/api/bots/${bot.id}`);
    expect(GetBotResponseSchema.parse(get.body).bot.sourceIds).toEqual([a, b]);
  });

  it('GET lists bots with their sourceIds', async () => {
    t = makeTestApp();
    const a = seedSource(t.db, { id: 'src-a' });
    await createBot({ name: 'with-src', sourceIds: [a] });
    await createBot({ name: 'bare' });

    const res = await request(t.app).get('/api/bots');

    expect(res.status).toBe(200);
    const { bots: list } = ListBotsResponseSchema.parse(res.body);
    expect(list).toHaveLength(2);
    const byName = Object.fromEntries(list.map((b) => [b.name, b]));
    expect(byName['with-src']?.sourceIds).toEqual([a]);
    expect(byName.bare?.sourceIds).toEqual([]);
  });

  it('POST rejects schema-invalid bodies with 400 VALIDATION', async () => {
    t = makeTestApp();

    for (const body of [
      {}, // name required
      { name: '' },
      { name: 'x', modelOverride: 42 },
      { name: 'x', sourceIds: 'not-an-array' },
      { name: 'x', bogus: 1 }, // strict object
    ]) {
      const res = await createBot(body);
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION');
    }
    expect(t.db.select().from(bots).all()).toHaveLength(0);
  });

  it('POST rejects unknown sourceIds with 400 VALIDATION and persists nothing', async () => {
    t = makeTestApp();
    seedSource(t.db, { id: 'src-real' });

    const res = await createBot({ name: 'x', sourceIds: ['src-real', 'src-ghost'] });

    expect(res.status).toBe(400);
    const parsed = ApiErrorSchema.parse(res.body);
    expect(parsed.error.code).toBe('VALIDATION');
    expect(parsed.error.details?.field).toBe('sourceIds');
    expect(t.db.select().from(bots).all()).toHaveLength(0);
    expect(t.db.select().from(botSources).all()).toHaveLength(0);
  });

  it('GET /:id returns the bot and 404s on unknown ids', async () => {
    t = makeTestApp();
    const { bot } = CreateBotResponseSchema.parse((await createBot()).body);

    const res = await request(t.app).get(`/api/bots/${bot.id}`);
    expect(res.status).toBe(200);
    expect(GetBotResponseSchema.parse(res.body).bot.id).toBe(bot.id);

    const missing = await request(t.app).get('/api/bots/nope');
    expect(missing.status).toBe(404);
    expect(ApiErrorSchema.parse(missing.body).error.code).toBe('NOT_FOUND');
  });

  it('PUT is a true partial: omitted fields stay unchanged', async () => {
    t = makeTestApp();
    const a = seedSource(t.db, { id: 'src-a' });
    const { bot } = CreateBotResponseSchema.parse(
      (
        await createBot({
          name: 'before',
          systemPrompt: 'keep me',
          modelOverride: 'acme/pro',
          sourceIds: [a],
        })
      ).body,
    );

    const res = await request(t.app).put(`/api/bots/${bot.id}`).send({ name: 'after' });

    expect(res.status).toBe(200);
    const { bot: updated } = UpdateBotResponseSchema.parse(res.body);
    expect(updated.name).toBe('after');
    expect(updated.systemPrompt).toBe('keep me');
    expect(updated.modelOverride).toBe('acme/pro');
    expect(updated.sourceIds).toEqual([a]);
  });

  it('PUT clears the override with null and replaces sourceIds', async () => {
    t = makeTestApp();
    const a = seedSource(t.db, { id: 'src-a' });
    const b = seedSource(t.db, { id: 'src-b' });
    const { bot } = CreateBotResponseSchema.parse(
      (await createBot({ name: 'x', modelOverride: 'acme/pro', sourceIds: [a] })).body,
    );

    const res = await request(t.app)
      .put(`/api/bots/${bot.id}`)
      .send({ modelOverride: null, sourceIds: [b] });

    expect(res.status).toBe(200);
    const { bot: updated } = UpdateBotResponseSchema.parse(res.body);
    expect(updated.modelOverride).toBeNull();
    expect(updated.sourceIds).toEqual([b]);
    expect(t.db.select().from(botSources).where(eq(botSources.botId, bot.id)).all()).toEqual([
      { botId: bot.id, sourceId: b },
    ]);
  });

  it('PUT 404s on unknown bots, 400s on invalid bodies and unknown sources', async () => {
    t = makeTestApp();
    const { bot } = CreateBotResponseSchema.parse((await createBot()).body);

    const missing = await request(t.app).put('/api/bots/nope').send({ name: 'x' });
    expect(missing.status).toBe(404);
    expect(ApiErrorSchema.parse(missing.body).error.code).toBe('NOT_FOUND');

    for (const body of [{ name: '' }, { name: 42 }, { bogus: 1 }]) {
      const res = await request(t.app).put(`/api/bots/${bot.id}`).send(body);
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(res.body).error.code).toBe('VALIDATION');
    }

    const ghost = await request(t.app)
      .put(`/api/bots/${bot.id}`)
      .send({ sourceIds: ['ghost'] });
    expect(ghost.status).toBe(400);
    expect(ApiErrorSchema.parse(ghost.body).error.details?.field).toBe('sourceIds');

    // Failed updates changed nothing.
    expect(
      GetBotResponseSchema.parse((await request(t.app).get(`/api/bots/${bot.id}`)).body).bot,
    ).toMatchObject({ name: 'philo', sourceIds: [] });
  });

  it('DELETE removes the bot and cascades attachments and chats', async () => {
    t = makeTestApp();
    const a = seedSource(t.db, { id: 'src-a' });
    const { bot } = CreateBotResponseSchema.parse(
      (await createBot({ name: 'x', sourceIds: [a] })).body,
    );
    const now = new Date().toISOString();
    t.db
      .insert(chats)
      .values({ id: 'chat-1', botId: bot.id, title: 't', createdAt: now, updatedAt: now })
      .run();

    const res = await request(t.app).delete(`/api/bots/${bot.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(t.db.select().from(bots).all()).toHaveLength(0);
    expect(t.db.select().from(botSources).all()).toHaveLength(0);
    expect(t.db.select().from(chats).all()).toHaveLength(0);

    const again = await request(t.app).delete(`/api/bots/${bot.id}`);
    expect(again.status).toBe(404);
  });
});
