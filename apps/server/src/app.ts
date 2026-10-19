// Express app factory. Pure: all dependencies (config, db) are injected so
// tests can wire a temp-dir DB without touching process.env or the network.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiError, ApiErrorCode } from '@tubescribe/shared';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import {
  type ChatModelFactory,
  createOpenRouterChatModelFactory,
  registerChatRoutes,
} from './chat.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { type Embedder, createOpenRouterEmbedder } from './embed/embedder.js';
import { HttpError } from './http-error.js';
import { createLogger } from './logger.js';
import { createHttpLogger } from './middleware.js';
import { registerBotsRoutes } from './routes/bots.js';
import { registerChatsRoutes } from './routes/chats.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerModelsRoutes } from './routes/models.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSourcesRoutes } from './routes/sources.js';
import type { InnertubeFactory } from './youtube/types.js';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Youtube client factory for the sources routes (resolve/list). */
  youtube: InnertubeFactory;
  /** Extraction worker handle — woken after a job is enqueued. */
  worker?: { notify(): void };
  /** Embed worker handle — woken after a reindex job is enqueued. */
  embedWorker?: { notify(): void };
  /** Embeddings client for chat retrieval (tests inject the fake). */
  embedder?: Embedder;
  /** Chat LLM factory (tests inject ai/test mocks). */
  chatModel?: ChatModelFactory;
  /** fetch for the OpenRouter model catalog proxy (tests inject a fake). */
  fetchFn?: typeof fetch;
  /**
   * Prod serving (task 14): directory with the built web app. `undefined`
   * resolves <repo>/apps/web/dist when it contains index.html; `null`
   * disables static serving (tests); a string pins the directory.
   */
  webDist?: string | null;
}

// Resolved like config.ts: repo root is three levels up from src/ and dist/.
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url));

function resolveWebDist(option: string | null | undefined): string | null {
  if (option === null) return null;
  const dir = option ?? DEFAULT_WEB_DIST;
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

function apiError(code: ApiErrorCode, message: string, details?: HttpError['details']): ApiError {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/** body-parser JSON syntax errors are SyntaxErrors with a numeric `status`. */
function isBodyParseError(err: unknown): err is SyntaxError & { status: number } {
  return (
    err instanceof SyntaxError && 'status' in err && (err as { status?: unknown }).status === 400
  );
}

export function createApp({
  config,
  db,
  youtube,
  worker,
  embedWorker,
  embedder,
  chatModel,
  fetchFn,
  webDist: webDistOption,
}: AppDeps): Express {
  const logger = createLogger(config);
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(createHttpLogger(logger));

  registerHealthRoutes(app);
  registerSettingsRoutes(app, db, config);
  registerSourcesRoutes(app, { db, config, youtube, worker, embedWorker, logger });
  registerJobsRoutes(app, db);
  registerBotsRoutes(app, db);
  registerModelsRoutes(app, { fetchFn, logger });
  registerChatsRoutes(app, db);
  registerChatRoutes(app, {
    db,
    config,
    // Defaults do no I/O at construction; both are always injected in tests.
    embedder: embedder ?? createOpenRouterEmbedder({ apiKey: config.openrouterApiKey, logger }),
    chatModel: chatModel ?? createOpenRouterChatModelFactory(config),
    logger,
  });

  // Prod serving: the built web app, when present. API 404s stay JSON; any
  // other GET falls back to index.html so client-side routes load directly.
  const webDist = resolveWebDist(webDistOption);
  if (webDist) app.use(express.static(webDist));
  app.use('/api', (_req, res) => {
    res.status(404).json(apiError('NOT_FOUND', 'Not found'));
  });
  if (webDist) {
    app.get('*', (_req, res) => {
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  // Unknown routes → 404 in the shared error shape.
  app.use((_req, res) => {
    res.status(404).json(apiError('NOT_FOUND', 'Not found'));
  });

  // Centralized error handler — keep registered last.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      res.status(400).json(
        apiError('VALIDATION', 'Request validation failed', {
          field: first && first.path.length > 0 ? first.path.join('.') : undefined,
          reason: first?.message,
        }),
      );
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json(apiError(err.code, err.message, err.details));
      return;
    }
    if (isBodyParseError(err)) {
      res.status(400).json(apiError('BAD_REQUEST', 'Invalid JSON body'));
      return;
    }
    logger.error({ err }, 'unhandled error');
    res.status(500).json(apiError('INTERNAL', 'Internal server error'));
  });

  return app;
}
