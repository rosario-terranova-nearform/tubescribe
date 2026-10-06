// drizzle-kit config (tooling only — the app never imports this).
// NOTE: this file is a sanctioned exception to the "env only via src/config.ts"
// rule because drizzle-kit runs as its own process; it mirrors config.ts by
// resolving a relative DATA_DIR against the repo root.

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const DOTENV_PATH = resolve(REPO_ROOT, '.env');
if (existsSync(DOTENV_PATH)) {
  loadDotenv({ path: DOTENV_PATH });
}

const rawDataDir = process.env.DATA_DIR ?? './data';
const dataDir = isAbsolute(rawDataDir) ? rawDataDir : resolve(REPO_ROOT, rawDataDir);

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: resolve(dataDir, 'tubescribe.db'),
  },
});
