// Test helpers: build an app wired to a throwaway temp-dir DB.
// Excluded from the production build (see tsconfig.build.json).

import type { Express } from 'express';
import { createApp } from '../app.js';
import type { ChatModelFactory } from '../chat.js';
import type { Config } from '../config.js';
import type { Embedder } from '../embed/embedder.js';
import type { InnertubeFactory } from '../youtube/types.js';
import { fakeEmbedder } from './fake-embedder.js';
import { type TestDb, makeTestDb } from './test-db.js';

export { makeTestConfig } from './test-db.js';

export interface TestAppDeps {
  youtube?: InnertubeFactory;
  worker?: { notify(): void };
  embedWorker?: { notify(): void };
  /** Defaults to the deterministic fake embedder (no network). */
  embedder?: Embedder;
  /** Loud default: chat tests must inject a fake (see fake-chat-model.ts). */
  chatModel?: ChatModelFactory;
  /** Loud default for the models proxy: no fetch unless injected. */
  fetchFn?: typeof fetch;
}

export interface TestApp extends TestDb {
  app: Express;
}

/** Loud default: tests hitting youtube endpoints must inject a fake client. */
const noYoutube: InnertubeFactory = () =>
  Promise.reject(new Error('test app has no youtube client; inject a fake via makeTestApp deps'));

const noChatModel: ChatModelFactory = () => {
  throw new Error('test app has no chat model; inject a fake via makeTestApp deps');
};

const noFetch: typeof fetch = () =>
  Promise.reject(new Error('test app has no fetch; inject a fake via makeTestApp deps'));

export function makeTestApp(overrides: Partial<Config> = {}, deps: TestAppDeps = {}): TestApp {
  const base = makeTestDb(overrides);
  const app = createApp({
    config: base.config,
    db: base.db,
    youtube: deps.youtube ?? noYoutube,
    worker: deps.worker,
    embedWorker: deps.embedWorker,
    embedder: deps.embedder ?? fakeEmbedder(),
    chatModel: deps.chatModel ?? noChatModel,
    fetchFn: deps.fetchFn ?? noFetch,
  });
  return { ...base, app };
}
