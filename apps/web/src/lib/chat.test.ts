import type { UIMessageChunk } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import { type ChatUIMessage, NdjsonChatTransport, messageText, toChatUIMessage } from './chat.ts';

const CITATION = {
  videoId: 'abc123',
  sourceId: 'src_1',
  title: 'Building a Second Brain',
  startMs: 83_000,
  endMs: 97_000,
  text: 'chunk text',
};

function ndjsonResponse(chunks: unknown[], status = 200): Response {
  const body = `${chunks.map((c) => JSON.stringify(c)).join('\n')}\n`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

function userMessage(text: string): ChatUIMessage {
  return { id: 'u1', role: 'user', parts: [{ type: 'text', text }] };
}

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

function stubFetch(response: Response | (() => Promise<Response>)) {
  const spy = vi.fn(() =>
    typeof response === 'function' ? response() : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NdjsonChatTransport', () => {
  it('posts the last user message and maps the NDJSON stream to UI chunks', async () => {
    const fetchSpy = stubFetch(
      ndjsonResponse([
        { type: 'citations', citations: [CITATION] },
        { type: 'delta', content: 'Hello' },
        { type: 'delta', content: ' world [1]' },
        { type: 'done', messageId: 'm_1' },
      ]),
    );
    const transport = new NdjsonChatTransport();
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat_1',
      messageId: undefined,
      messages: [userMessage('What is a second brain?')],
      abortSignal: undefined,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/chats/chat_1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'What is a second brain?' }),
      }),
    );

    const types = (await collect(stream)).map((c) => c.type);
    expect(types).toEqual([
      'start',
      'message-metadata',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ]);
  });

  it('attaches citations as message metadata', async () => {
    stubFetch(
      ndjsonResponse([
        { type: 'citations', citations: [CITATION] },
        { type: 'done', messageId: 'm_1' },
      ]),
    );
    const transport = new NdjsonChatTransport();
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat_1',
      messageId: undefined,
      messages: [userMessage('hi')],
      abortSignal: undefined,
    });
    const chunks = await collect(stream);
    const metadata = chunks.find((c) => c.type === 'message-metadata');
    expect(metadata).toEqual({
      type: 'message-metadata',
      messageMetadata: { citations: [CITATION] },
    });
  });

  it('maps a mid-stream error chunk and tolerates corrupt lines', async () => {
    const body =
      '{"type":"delta","content":"partial"}\nnot json\n{"type":"error","message":"model exploded"}\n';
    stubFetch(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
    );
    const transport = new NdjsonChatTransport();
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat_1',
      messageId: undefined,
      messages: [userMessage('hi')],
      abortSignal: undefined,
    });
    const chunks = await collect(stream);
    const last = chunks.at(-1);
    expect(last).toEqual({ type: 'error', errorText: 'model exploded' });
  });

  it('emits an error chunk when the stream ends without done/error', async () => {
    stubFetch(ndjsonResponse([{ type: 'delta', content: 'cut off' }]));
    const transport = new NdjsonChatTransport();
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat_1',
      messageId: undefined,
      messages: [userMessage('hi')],
      abortSignal: undefined,
    });
    const chunks = await collect(stream);
    expect(chunks.at(-1)?.type).toBe('error');
  });

  it('throws an ApiRequestError for a non-OK response', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'chat not found: x' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const transport = new NdjsonChatTransport();
    await expect(
      transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'nope',
        messageId: undefined,
        messages: [userMessage('hi')],
        abortSignal: undefined,
      }),
    ).rejects.toSatisfy(
      (err) => err instanceof ApiRequestError && err.status === 404 && err.code === 'NOT_FOUND',
    );
  });
});

describe('toChatUIMessage', () => {
  it('maps persisted messages and keeps citations in metadata', () => {
    const ui = toChatUIMessage({
      id: 'm_1',
      chatId: 'chat_1',
      role: 'assistant',
      content: 'Answer [1]',
      citations: [CITATION],
      createdAt: '2026-10-19T00:00:00.000Z',
    });
    expect(ui).toEqual({
      id: 'm_1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Answer [1]' }],
      metadata: { citations: [CITATION] },
    });
  });

  it('omits metadata when the message has no citations', () => {
    const ui = toChatUIMessage({
      id: 'm_2',
      chatId: 'chat_1',
      role: 'user',
      content: 'question',
      createdAt: '2026-10-19T00:00:00.000Z',
    });
    expect(ui.metadata).toBeUndefined();
    expect(messageText(ui)).toBe('question');
  });
});
