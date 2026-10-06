// Express app factory. Pure: all dependencies (config, db) are injected so
// tests can wire a temp-dir DB without touching process.env or the network.

import type { ApiError, ApiErrorCode } from '@tubescribe/shared';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { HttpError } from './http-error.js';
import { createLogger } from './logger.js';
import { createHttpLogger } from './middleware.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSettingsRoutes } from './routes/settings.js';

export interface AppDeps {
  config: Config;
  db: Db;
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

export function createApp({ config, db }: AppDeps): Express {
  const logger = createLogger(config);
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(createHttpLogger(logger));

  registerHealthRoutes(app);
  registerSettingsRoutes(app, db);

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
