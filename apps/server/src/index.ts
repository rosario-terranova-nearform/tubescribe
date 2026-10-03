import express, { type Express } from 'express';
import { createLogger } from './logger.js';
import { createHttpLogger } from './middleware.js';
import { registerHealthRoutes } from './routes/health.js';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);

export function createApp(): Express {
  const logger = createLogger();
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(createHttpLogger(logger));

  registerHealthRoutes(app);

  // Centralized error handler — keep registered last.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error({ err }, 'unhandled error');
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    },
  );

  return app;
}

async function main(): Promise<void> {
  const app = createApp();
  const logger = createLogger();

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'server listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run when invoked as the entry point (skipped when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
