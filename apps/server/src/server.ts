// Server entry point: load config, open + migrate the DB, seed settings,
// then start listening. Import nothing here from tests — use app.ts instead.

import { createApp } from './app.js';
import { getConfig } from './config.js';
import { createDb, runMigrations } from './db/client.js';
import { createExtractionWorker } from './jobs/worker.js';
import { createLogger } from './logger.js';
import { seedSettings } from './settings.js';
import { createDefaultClient } from './youtube/client.js';

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger(config);

  const { db, sqlite } = createDb(config.dataDir);
  runMigrations(db);
  seedSettings(db, config);
  logger.info({ dataDir: config.dataDir }, 'database ready');

  // Extraction worker: resumes queued/running jobs on boot (see jobs/worker.ts).
  const worker = createExtractionWorker({ db, config, logger });

  const app = createApp({ config, db, youtube: createDefaultClient, worker });
  worker.start();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'server listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    void (async () => {
      await worker.stop();
      server.close(() => {
        sqlite.close();
        process.exit(0);
      });
    })().catch((err: unknown) => {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
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
