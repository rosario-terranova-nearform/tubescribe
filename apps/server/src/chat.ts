// Streaming chat endpoint (task 08): POST /api/chats/:id/messages.
//
// Pipeline: persist the user message → retrieve top-8 corpus chunks scoped
// to the bot's attached sources (task 07) → streamText with the bot's model
// (modelOverride, else the settings default chat model) → persist the
// assistant message with its citation metadata, so history renders
// citations without re-retrieval. Empty retrieval still answers, with a
// prompt note that no corpus context was found.
//
// Wire format: NDJSON — one JSON object per line following the shared
// SendMessageChunk union (citations → delta* → done | error).

import { randomUUID } from 'node:crypto';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type Citation, type SendMessageChunk, SendMessageRequestSchema } from '@tubescribe/shared';
import { type LanguageModel, type ModelMessage, streamText } from 'ai';
import { eq } from 'drizzle-orm';
import type { Express, NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { bots, chats, messages } from './db/schema.js';
import type { Embedder } from './embed/embedder.js';
import { type RetrievedChunk, retrieveForBot } from './embed/retrieve.js';
import { HttpError } from './http-error.js';
import { getChatOr404, listMessages } from './routes/chats.js';
import { getSettings } from './settings.js';

/** Injected boundary for the chat LLM (tests substitute ai/test mocks). */
export type ChatModelFactory = (modelId: string) => LanguageModel;

export interface ChatRouteDeps {
  db: Db;
  config: Pick<Config, 'defaultChatModel'>;
  embedder: Embedder;
  chatModel: ChatModelFactory;
  logger?: Logger;
}

/** Production factory: OpenRouter chat models via the AI SDK. */
export function createOpenRouterChatModelFactory(
  config: Pick<Config, 'openrouterApiKey'>,
): ChatModelFactory {
  // '' (not undefined) so the provider never falls back to reading
  // OPENROUTER_API_KEY from process.env itself — env access is config-only.
  const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey ?? '' });
  return (modelId) => openrouter.chat(modelId);
}

/** mm:ss (h:mm:ss past one hour) for context-block headers. */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const GROUNDING_INSTRUCTIONS = [
  'You answer questions grounded in excerpts from the user’s YouTube transcript corpus.',
  'The relevant excerpts are provided as numbered context blocks; each block starts with "[n] <video title> @ <mm:ss>".',
  'When you use information from a block, cite it inline as [n]. If the blocks do not contain the answer, say so instead of guessing.',
].join(' ');

const NO_CONTEXT_NOTE =
  'No corpus context was found for this question (the attached sources may not be embedded yet). Answer from general knowledge and note that no transcript context was available.';

/** Bot system prompt + numbered context blocks (`[1] title @ mm:ss`). */
export function buildSystemPrompt(systemPrompt: string, chunks: RetrievedChunk[]): string {
  const base = systemPrompt.trim() || 'You are a helpful assistant.';
  if (chunks.length === 0) {
    return `${base}\n\n${GROUNDING_INSTRUCTIONS}\n\n${NO_CONTEXT_NOTE}`;
  }
  const blocks = chunks.map(
    (c, i) => `[${i + 1}] ${c.title} @ ${formatTimestamp(c.startMs)}\n${c.text}`,
  );
  return `${base}\n\n${GROUNDING_INSTRUCTIONS}\n\nContext:\n\n${blocks.join('\n\n')}`;
}

/** Express 4 does not forward async rejections to the error middleware.
 *  The route params are typed explicitly — the default Request params are an
 *  index signature, which noUncheckedIndexedAccess makes `string | undefined`. */
function ah(fn: (req: Request<{ id: string }>, res: Response) => Promise<void>) {
  return (req: Request<{ id: string }>, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerChatRoutes(app: Express, deps: ChatRouteDeps): void {
  const { db, config, embedder, chatModel, logger } = deps;

  app.post(
    '/api/chats/:id/messages',
    ah(async (req, res) => {
      const { content } = SendMessageRequestSchema.parse(req.body ?? {});
      const chat = getChatOr404(db, req.params.id);
      const bot = db.select().from(bots).where(eq(bots.id, chat.botId)).get();
      // Unreachable through the API (FK cascade) — defensive 404 either way.
      if (!bot) throw new HttpError(404, 'NOT_FOUND', `bot not found: ${chat.botId}`);
      const modelId =
        bot.modelOverride ?? getSettings(db).defaultChatModel ?? config.defaultChatModel;

      // 1. Persist the user message.
      db.insert(messages)
        .values({
          id: randomUUID(),
          chatId: chat.id,
          role: 'user',
          content,
          createdAt: new Date().toISOString(),
        })
        .run();

      // 2. Retrieve top-k chunks for the bot's sources ([] when the bot has
      //    no sources or nothing is embedded yet — the chat still answers).
      const retrieved = await retrieveForBot({ db, embedder }, { botId: bot.id, query: content });
      const citations: Citation[] = retrieved.map((c) => ({
        videoId: c.videoId,
        sourceId: c.sourceId,
        title: c.title,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
      }));

      // 3. Prompt: bot system prompt + numbered context blocks, with the
      //    persisted history (ending at the just-inserted user message).
      const system = buildSystemPrompt(bot.systemPrompt, retrieved);
      const modelMessages: ModelMessage[] = listMessages(db, chat.id)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      // 4. Stream NDJSON. Headers go out only once retrieval succeeded, so
      //    pre-stream failures still return the JSON error envelope.
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      const write = (chunk: SendMessageChunk) => res.write(`${JSON.stringify(chunk)}\n`);
      write({ type: 'citations', citations });

      let text = '';
      try {
        const result = streamText({
          model: chatModel(modelId),
          system,
          messages: modelMessages,
          // Stream errors arrive as fullStream error parts (handled below);
          // the SDK's default onError would console.error behind the logger.
          onError: () => {},
        });
        // fullStream (not textStream): provider failures surface as 'error'
        // parts here instead of silently ending the text stream.
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            text += part.text;
            write({ type: 'delta', content: part.text });
          } else if (part.type === 'error') {
            throw part.error instanceof Error ? part.error : new Error(String(part.error));
          }
        }
      } catch (err) {
        // Mid-stream failure: the NDJSON error chunk is the only channel left;
        // the partial answer is not persisted.
        logger?.error({ err, chatId: chat.id }, 'chat stream failed');
        write({ type: 'error', message: describe(err) });
        res.end();
        return;
      }

      // 5. Persist the assistant message with its citation metadata.
      const assistantId = randomUUID();
      db.insert(messages)
        .values({
          id: assistantId,
          chatId: chat.id,
          role: 'assistant',
          content: text,
          citations,
          createdAt: new Date().toISOString(),
        })
        .run();
      db.update(chats)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(chats.id, chat.id))
        .run();
      write({ type: 'done', messageId: assistantId });
      res.end();
    }),
  );
}
