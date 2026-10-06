# Task 03: Server foundation: config, logger, DB, settings

**Status**: done (2026-10-06)
**Depends on**: 01, 02

## Goal

Express app skeleton with config, logging, database, and the settings API.

## Scope

`apps/server/src/`:

- `config.ts`: dotenv + zod-parsed env (`PORT`, `DATA_DIR`, `OPENROUTER_API_KEY` optional-for-now, `DEFAULT_CHAT_MODEL`, `DEFAULT_EMBEDDING_MODEL`, extraction knobs `TRANSCRIPT_*`); the only place `process.env` is read
- `logger.ts`: pino
- `app.ts`: express factory, JSON body parsing, error middleware mapping zod errors to 400 with the shared error schema, unknown routes to 404
- `db/client.ts`: better-sqlite3 + drizzle, creates `DATA_DIR` recursively, DB at `<DATA_DIR>/tubescribe.db`, WAL mode
- `db/schema.ts`: tables `sources`, `videos`, `jobs`, `job_items`, `bots`, `bot_sources`, `chats`, `messages`, `settings` (key/value)
- `drizzle.config.ts` + initial migration; `pnpm db:migrate` script
- `routes/health.ts`, `routes/settings.ts` (`GET/PUT /api/settings`, validated with shared schemas; seeded from env defaults on first boot)
- `server.ts` entry

## Key decisions

- Settings live in the DB and are editable via API, but the OpenRouter key stays `.env`-only (never returned by any endpoint)
- All timestamps ISO strings; ids: `crypto.randomUUID()`

## Acceptance criteria

- [ ] Integration tests (supertest): health, settings get/put round trip, 400 on invalid settings body, 404 shape
- [ ] Fresh DB migrates cleanly in a temp dir
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` green
