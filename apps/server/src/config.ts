// Central server configuration.
// This is the ONLY module allowed to read `process.env` (see AGENTS.md).
// Everything else receives config via injection (`createApp({ config, db })`).

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '@tubescribe/shared';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Repo root is three levels up from both src/config.ts and dist/config.js.
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// Fallback for running without `--env-file` (dev/start scripts already pass it;
// dotenv never overrides variables that are already set).
const DOTENV_PATH = resolve(REPO_ROOT, '.env');
if (existsSync(DOTENV_PATH)) {
  loadDotenv({ path: DOTENV_PATH });
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  // Relative paths resolve against the repo root, not the process cwd.
  DATA_DIR: z.string().min(1).default('./data'),
  // Optional for now (task 08 needs it); empty string in .env means "unset".
  OPENROUTER_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEFAULT_CHAT_MODEL: z.string().min(1).default(DEFAULT_SETTINGS.defaultChatModel),
  DEFAULT_EMBEDDING_MODEL: z.string().min(1).default(DEFAULT_SETTINGS.defaultEmbeddingModel),
  // YouTube bot-detection defense knobs (docs/DESIGN.md).
  TRANSCRIPT_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(2)
    .default(DEFAULT_SETTINGS.transcriptFetchConcurrency),
  TRANSCRIPT_DELAY_MIN_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_SETTINGS.youtubeRequestDelayMsMin),
  TRANSCRIPT_DELAY_MAX_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_SETTINGS.youtubeRequestDelayMsMax),
  TRANSCRIPT_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
});

export const ConfigSchema = EnvSchema.transform((env) => ({
  port: env.PORT,
  dataDir: isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(REPO_ROOT, env.DATA_DIR),
  openrouterApiKey: env.OPENROUTER_API_KEY,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  defaultChatModel: env.DEFAULT_CHAT_MODEL,
  defaultEmbeddingModel: env.DEFAULT_EMBEDDING_MODEL,
  transcriptConcurrency: env.TRANSCRIPT_CONCURRENCY,
  transcriptDelayMinMs: env.TRANSCRIPT_DELAY_MIN_MS,
  transcriptDelayMaxMs: env.TRANSCRIPT_DELAY_MAX_MS,
  transcriptMaxRetries: env.TRANSCRIPT_MAX_RETRIES,
}));

export type Config = z.infer<typeof ConfigSchema>;

/** Parse an env-like object into a Config. Throws ZodError on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}

let cached: Config | undefined;

/** Process-wide config, parsed once from `process.env`. */
export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
