// Chat client plumbing (task 12).
//
// The server's POST /api/chats/:id/messages speaks tubescribe's NDJSON chunk
// protocol (citations → delta* → done | error), not the AI SDK's UI message
// stream protocol — NdjsonChatTransport adapts it to the ChatTransport
// interface that @ai-sdk/react's useChat consumes. Citations arrive as AI
// SDK message metadata and stay attached to the assistant message; history
// loads put the persisted citations into the same place (toChatUIMessage).

import { toApiRequestError } from '@/api/client.ts';
import { type Citation, type Message, SendMessageChunkSchema } from '@tubescribe/shared';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

/** Assistant message metadata: the citation set persisted server-side. */
export interface ChatMessageMetadata {
  citations: Citation[];
}

export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

/** Persisted message → UIMessage; citations ride in metadata, never re-derived. */
export function toChatUIMessage(message: Message): ChatUIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: [{ type: 'text', text: message.content }],
    metadata: message.citations ? { citations: message.citations } : undefined,
  };
}

/** Concatenated text of a message's text parts (the only part type we use). */
export function messageText(message: ChatUIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** Yields each non-empty NDJSON line from a response body stream. */
async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield line;
        newline = buffer.indexOf('\n');
      }
    }
    const rest = buffer.trim();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

/**
 * ChatTransport over POST /api/chats/:chatId/messages. The server persists
 * history, so only the last user message's text is sent; the response stream
 * is translated chunk-for-chunk into UIMessageChunks.
 */
export class NdjsonChatTransport implements ChatTransport<ChatUIMessage> {
  async sendMessages({
    chatId,
    messages,
    abortSignal,
  }: Parameters<ChatTransport<ChatUIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const content = lastUser ? messageText(lastUser) : '';

    let response: Response;
    try {
      response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ content }),
        signal: abortSignal ?? null,
      });
    } catch (cause) {
      if (abortSignal?.aborted) throw cause;
      throw new Error(cause instanceof Error ? cause.message : 'Network request failed', {
        cause,
      });
    }
    if (!response.ok) throw await toApiRequestError(response);
    if (!response.body) throw new Error('The chat endpoint returned no response body.');
    const body = response.body;

    const textId = crypto.randomUUID();
    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        let textStarted = false;
        let terminated = false;
        try {
          controller.enqueue({ type: 'start', messageId: crypto.randomUUID() });
          for await (const line of ndjsonLines(body)) {
            let json: unknown;
            try {
              json = JSON.parse(line);
            } catch {
              continue; // tolerate a partial/corrupt line instead of killing the stream
            }
            const parsed = SendMessageChunkSchema.safeParse(json);
            if (!parsed.success) continue;
            const chunk = parsed.data;
            if (chunk.type === 'citations') {
              controller.enqueue({
                type: 'message-metadata',
                messageMetadata: { citations: chunk.citations },
              });
            } else if (chunk.type === 'delta') {
              if (!textStarted) {
                controller.enqueue({ type: 'text-start', id: textId });
                textStarted = true;
              }
              controller.enqueue({ type: 'text-delta', id: textId, delta: chunk.content });
            } else if (chunk.type === 'done') {
              terminated = true;
              if (textStarted) controller.enqueue({ type: 'text-end', id: textId });
              controller.enqueue({ type: 'finish' });
            } else if (chunk.type === 'error') {
              terminated = true;
              controller.enqueue({ type: 'error', errorText: chunk.message });
            }
          }
          if (!terminated) {
            controller.enqueue({
              type: 'error',
              errorText: 'The response stream ended before the answer completed.',
            });
          }
          controller.close();
        } catch (err) {
          // A deliberate stop() aborts the fetch — close quietly, no error state.
          if (abortSignal?.aborted) {
            controller.close();
            return;
          }
          controller.error(err);
        }
      },
    });
  }

  /** No stream resumption: answers are persisted, reloads read history. */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
