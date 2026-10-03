# AGENTS.md

## What this is

**tubescribe**: a local, single-user, fullstack TypeScript app. Paste a YouTube channel, playlist, or video; it extracts every transcript into a local corpus; you create LLM "bots" grounded on chosen sources and chat with them via OpenRouter, with clickable timestamp citations.

- **Settled design decisions**: `docs/DESIGN.md` (the source of truth, do not deviate without asking the user)
- **Implementation plan**: `docs/tasks/` (numbered, with dependencies and acceptance criteria; statuses tracked in `docs/tasks/README.md`)

## Stack

- pnpm monorepo: `apps/server` (Express + TS, :3001), `apps/web` (Vite + React + TS, :5173), `packages/shared` (zod schemas + types)
- ESM-only (`"type": "module"` everywhere), TS strict, Node >= 22
- SQLite via better-sqlite3 + Drizzle (drizzle-kit migrations); vectors via sqlite-vec; transcripts as JSON + MD files under `data/`
- youtubei.js (keyless) for discovery + transcripts; the `youtube-transcript` npm package as fallback engine
- Vercel AI SDK v7 + `@openrouter/ai-sdk-provider`; OpenRouter key in server `.env` only, never sent to the web client
- Web: Tailwind v4 + shadcn/ui, react-router v7, react-hook-form + zod, TanStack Query
- vitest (unit + integration), biome (lint + format), pino (server logging)

## Commands

Available once task 01 lands:

| Command | What it does |
| --- | --- |
| `pnpm dev` | server (`tsx watch`, :3001) + web (Vite, :5173, `/api` proxied) |
| `pnpm build` | `tsc -b` (server + shared) + `vite build` (web) |
| `pnpm start` | built server, also serving built web app |
| `pnpm test` / `pnpm test:watch` | vitest across packages |
| `pnpm lint` / `pnpm format` | biome check / biome format |
| `pnpm typecheck` | `tsc --noEmit` across packages |
| `pnpm db:migrate` | drizzle-kit migrations |

## Conventions

- **API contracts**: zod schemas in `packages/shared` are the single source of truth; server validates requests with them, web parses responses with them.
- **Env access** only through the server config module (`apps/server/src/config.ts`); never scattered `process.env`.
- **Tests** colocated as `*.test.ts`; youtubei.js and OpenRouter are always mocked at injected client boundaries; recorded fixtures under `__fixtures__/`; no live network in tests.
- **Errors**: API errors use the shared error schema; extraction job failures are per-video (record + continue), never crash a job.
- `data/` and `.env` are gitignored; never commit secrets or corpus content.

## Gotchas (read before touching extraction)

- **YouTube bot detection is real** (youtubei.js issues #1102, #1119): keep the `TranscriptEngine` abstraction, the fallback chain, and the env-tunable rate knobs intact. See `docs/DESIGN.md`.
- youtubei.js is **pure ESM**; do not introduce CJS anywhere.
- sqlite-vec loads as a better-sqlite3 extension (`sqliteVec.load(db)`), see task 07.
- Anthropic models have **no embeddings** via the AI SDK; embeddings default to `openai/text-embedding-3-small` through OpenRouter.
- After editing `opencode.json` or anything under `.opencode/`, tell the user to **restart opencode** (config is loaded once at startup).

## Rules for agents

- Implement one task at a time from `docs/tasks/`, preferably via the `implement-task` skill; check task dependencies first.
- When a task is done, update its `**Status**` line and the index in `docs/tasks/README.md`.
- If you change structure, commands, or conventions, update this file in the same change.
- No git commits unless the user explicitly asks.
