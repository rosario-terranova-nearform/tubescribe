// Streaming chat endpoint integration tests. The AI SDK provider is mocked
// (ai/test MockLanguageModelV4 via fakeChatModel) and embeddings come from
// the deterministic fake embedder — no live network, ever.

import {
  ApiErrorSchema,
  CreateBotResponseSchema,
  CreateChatResponseSchema,
  GetChatResponseSchema,
  type SendMessageChunk,
  SendMessageChunkSchema,
} from '@tubescribe/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { chunks, videos } from './db/schema.js';
import type { Embedder } from './embed/embedder.js';
import { ensureVecChunksTable, insertChunkVectors, setEmbedState } from './embed/vec.js';
import { type FakeChatModel, fakeChatModel } from './testing/fake-chat-model.js';
import { fakeEmbedder } from './testing/fake-embedder.js';
import { type TestApp, makeTestApp } from './testing/test-app.js';
import { seedSource } from './testing/test-db.js';

const EMBED_MODEL = 'test/embed-model';

function seedVideo(t: TestApp, videoId: string, sourceId: string): void {
  t.db
    .insert(videos)
    .values({
      id: videoId,
      sourceId,
      title: `Title ${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: null,
      durationS: 60,
      language: 'en',
      status: 'embedded',
      fetchedAt: new Date().toISOString(),
      embeddedAt: new Date().toISOString(),
    })
    .run();
}

async function seedChunk(
  t: TestApp,
  embedder: Embedder,
  chunk: { id: string; videoId: string; sourceId: string; title: string; text: string },
): Promise<void> {
  t.db
    .insert(chunks)
    .values({ ...chunk, startMs: 0, endMs: 1500 })
    .run();
  const [embedding] = await embedder.embed(EMBED_MODEL, [chunk.text]);
  if (!embedding) throw new Error('fake embedder returned no vector');
  insertChunkVectors(t.db, [{ chunkId: chunk.id, sourceId: chunk.sourceId, embedding }]);
}

/** Raw-text POST: NDJSON bodies need the unparsed stream text. */
function postMessageRaw(app: Express, chatId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/chats/${chatId}/messages`)
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      let text = '';
      res.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
      });
      res.on('end', () => cb(null, text));
    });
}

function parseChunks(raw: string): SendMessageChunk[] {
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => SendMessageChunkSchema.parse(JSON.parse(line)));
}

async function makeBotWithSources(t: TestApp, sourceIds: string[], modelOverride?: string) {
  const res = await request(t.app)
    .post('/api/bots')
    .send({
      name: 'tutor',
      systemPrompt: 'You are a philosophy tutor.',
      ...(modelOverride ? { modelOverride } : {}),
      sourceIds,
    });
  expect(res.status).toBe(201);
  return CreateBotResponseSchema.parse(res.body).bot;
}

async function makeChat(t: TestApp, botId: string) {
  const res = await request(t.app).post(`/api/bots/${botId}/chats`).send({});
  expect(res.status).toBe(201);
  return CreateChatResponseSchema.parse(res.body).chat;
}

describe('POST /api/chats/:id/messages', () => {
  let t: TestApp;
  let embedder: ReturnType<typeof fakeEmbedder>;
  let chatModel: FakeChatModel;
  let sourceA: string;
  let sourceB: string;

  afterEach(() => t?.cleanup());

  async function setupCorpus() {
    sourceA = seedSource(t.db, { id: 'source-a' });
    sourceB = seedSource(t.db, { id: 'source-b' });
    seedVideo(t, 'vid-a', sourceA);
    seedVideo(t, 'vid-b', sourceB);
    ensureVecChunksTable(t.db, 8);
    setEmbedState(t.db, { model: EMBED_MODEL, dimension: 8 });
    await seedChunk(t, embedder, {
      id: 'chunk-a1',
      videoId: 'vid-a',
      sourceId: sourceA,
      title: 'Title vid-a',
      text: 'alpha bravo charlie',
    });
    await seedChunk(t, embedder, {
      id: 'chunk-b1',
      videoId: 'vid-b',
      sourceId: sourceB,
      title: 'Title vid-b',
      text: 'alpha bravo charlie', // identical text in the OTHER source
    });
  }

  function makeChatApp(options: Parameters<typeof fakeChatModel>[0] = {}) {
    embedder = fakeEmbedder();
    chatModel = fakeChatModel(options);
    t = makeTestApp({}, { embedder, chatModel: chatModel.factory });
  }

  it('streams NDJSON (citations → deltas → done) and persists both messages with citations', async () => {
    makeChatApp({ deltas: ['Hello', ' [1] world'] });
    await setupCorpus();
    const bot = await makeBotWithSources(t, [sourceA]);
    const chat = await makeChat(t, bot.id);

    const res = await postMessageRaw(t.app, chat.id, { content: 'alpha bravo charlie' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const stream = parseChunks(res.body as unknown as string);
    expect(stream[0]).toEqual({
      type: 'citations',
      citations: [
        {
          videoId: 'vid-a',
          sourceId: sourceA,
          title: 'Title vid-a',
          startMs: 0,
          endMs: 1500,
          text: 'alpha bravo charlie',
        },
      ],
    });
    const deltas = stream.filter((c) => c.type === 'delta').map((c) => c.content);
    expect(deltas).toEqual(['Hello', ' [1] world']);
    const done = stream.at(-1);
    expect(done?.type).toBe('done');

    // Both messages persisted; citations live on the assistant message.
    const history = GetChatResponseSchema.parse(
      (await request(t.app).get(`/api/chats/${chat.id}`)).body,
    );
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]).toMatchObject({ role: 'user', content: 'alpha bravo charlie' });
    expect(history.messages[0]).not.toHaveProperty('citations');
    expect(history.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello [1] world' });
    expect(history.messages[1]?.citations).toHaveLength(1);
    expect(history.messages[1]?.citations?.[0]).toMatchObject({ videoId: 'vid-a' });
    if (done?.type === 'done') {
      expect(history.messages[1]?.id).toBe(done.messageId);
    }

    // The model saw the bot system prompt, the numbered context block, and
    // the user question.
    const call = chatModel.mock.doStreamCalls[0];
    const promptJson = JSON.stringify(call?.prompt);
    expect(promptJson).toContain('You are a philosophy tutor.');
    expect(promptJson).toContain('[1] Title vid-a @ 00:00');
    expect(promptJson).toContain('alpha bravo charlie');
    expect(call?.prompt.at(-1)).toMatchObject({ role: 'user' });
  });

  it('scopes retrieval to the bot’s attached sources', async () => {
    makeChatApp();
    await setupCorpus();
    const bot = await makeBotWithSources(t, [sourceA]); // NOT sourceB
    const chat = await makeChat(t, bot.id);

    const res = await postMessageRaw(t.app, chat.id, { content: 'alpha bravo charlie' });

    const stream = parseChunks(res.body as unknown as string);
    const citationsChunk = stream.find((c) => c.type === 'citations');
    if (citationsChunk?.type !== 'citations') throw new Error('no citations chunk');
    expect(citationsChunk.citations.length).toBeGreaterThan(0);
    expect(citationsChunk.citations.every((c) => c.sourceId === sourceA)).toBe(true);
  });

  it('still answers with empty retrieval, noting the missing corpus context', async () => {
    makeChatApp();
    // No sources, no vec table — nothing retrievable.
    const bot = await makeBotWithSources(t, []);
    const chat = await makeChat(t, bot.id);

    const res = await postMessageRaw(t.app, chat.id, { content: 'what is up' });

    expect(res.status).toBe(200);
    const stream = parseChunks(res.body as unknown as string);
    expect(stream[0]).toEqual({ type: 'citations', citations: [] });
    expect(stream.some((c) => c.type === 'delta')).toBe(true);
    expect(stream.at(-1)?.type).toBe('done');

    const promptJson = JSON.stringify(chatModel.mock.doStreamCalls[0]?.prompt);
    expect(promptJson).toContain('No corpus context was found');

    const history = GetChatResponseSchema.parse(
      (await request(t.app).get(`/api/chats/${chat.id}`)).body,
    );
    expect(history.messages).toHaveLength(2);
    expect(history.messages[1]?.citations).toEqual([]);
  });

  it('resolves the model: modelOverride wins, else the settings default', async () => {
    makeChatApp();
    const overridden = await makeBotWithSources(t, [], 'acme/pro');
    const plain = await makeBotWithSources(t, []);
    const chatA = await makeChat(t, overridden.id);
    const chatB = await makeChat(t, plain.id);

    await postMessageRaw(t.app, chatA.id, { content: 'one' });
    await postMessageRaw(t.app, chatB.id, { content: 'two' });

    expect(chatModel.requestedModelIds).toEqual(['acme/pro', 'test/chat-model']);
  });

  it('includes prior history in the model call', async () => {
    makeChatApp({ deltas: ['First answer'] });
    const bot = await makeBotWithSources(t, []);
    const chat = await makeChat(t, bot.id);

    await postMessageRaw(t.app, chat.id, { content: 'first question' });
    await postMessageRaw(t.app, chat.id, { content: 'second question' });

    expect(chatModel.mock.doStreamCalls).toHaveLength(2);
    const second = chatModel.mock.doStreamCalls[1];
    expect(second?.prompt.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const promptJson = JSON.stringify(second?.prompt);
    expect(promptJson).toContain('first question');
    expect(promptJson).toContain('First answer');
    expect(promptJson).toContain('second question');
  });

  it('stream failures send an error chunk and persist no assistant message', async () => {
    makeChatApp({ error: new Error('boom') });
    const bot = await makeBotWithSources(t, []);
    const chat = await makeChat(t, bot.id);

    const res = await postMessageRaw(t.app, chat.id, { content: 'hi' });

    expect(res.status).toBe(200);
    const stream = parseChunks(res.body as unknown as string);
    expect(stream[0]).toEqual({ type: 'citations', citations: [] });
    expect(stream.at(-1)).toEqual({ type: 'error', message: 'boom' });

    const history = GetChatResponseSchema.parse(
      (await request(t.app).get(`/api/chats/${chat.id}`)).body,
    );
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('404s on unknown chats and 400s on empty content', async () => {
    makeChatApp();

    const missing = await postMessageRaw(t.app, 'nope', { content: 'hi' });
    expect(missing.status).toBe(404);
    expect(ApiErrorSchema.parse(JSON.parse(missing.body as unknown as string)).error.code).toBe(
      'NOT_FOUND',
    );

    const bot = await makeBotWithSources(t, []);
    const chat = await makeChat(t, bot.id);
    for (const body of [{ content: '' }, {}, { content: 42 }]) {
      const res = await postMessageRaw(t.app, chat.id, body);
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(JSON.parse(res.body as unknown as string)).error.code).toBe(
        'VALIDATION',
      );
    }
    expect(chatModel.requestedModelIds).toHaveLength(0);
  });
});
