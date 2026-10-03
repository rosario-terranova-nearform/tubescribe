# tubescribe: settled design

This document is the agreed design from the grilling rounds (2026-09-25). It is the source of truth for implementation. Any deviation goes back to the user first.

## What it is

A local, single-user, fullstack TypeScript app. Paste a YouTube channel, playlist, or video; it extracts every transcript to a local corpus; you create "bots" grounded on chosen sources and chat with them (via OpenRouter) with clickable timestamp citations.

## Architecture

- **pnpm monorepo**, no orchestrator: `apps/server` (Express + TS, :3001), `apps/web` (Vite + React + TS, :5173, `/api` proxied), `packages/shared` (zod schemas + types shared both ways)
- ESM everywhere, TS strict, Node >= 22, `tsx` dev / `tsc` build, **vitest**, **biome**, **pino** logging, dotenv
- **API**: REST + shared zod validation; web uses TanStack Query; **polling** for job progress (no SSE)

## Extraction (keyless)

- **youtubei.js v18**, no YouTube API key
- One smart paste input accepts any channel (@handle / UC id / any channel URL), playlist (`list=`), or video URL (`watch?v=`, `youtu.be`, `/shorts/`) or bare id; server normalizes, resolves title/thumbnail, shows a confirmation card, rejects duplicates
- Per-source **type filter**: uploads / shorts / live (select box in UI)
- Captions: prefer manual, fall back to auto (ASR), record `captionKind`; original language only, `language` recorded
- **Jobs**: SQLite-backed queue (`jobs` + `job_items`), per-video checkpoints, resumable across server restarts; adding a source auto-starts its extraction job
- **Bot-detection defense** (env-tunable):
  - transcript fetch concurrency 1 (max 2), randomized 1 to 3 s delay between fetches
  - jittered exponential backoff on 400/429/`LOGIN_REQUIRED`; 3 retries, then mark that video failed and continue the job
  - fallback chain per video: youtubei.js → youtubei.js with `TV_EMBEDDED` client → `youtube-transcript` package; success engine recorded per video

## Persistence

- SQLite via **better-sqlite3 + Drizzle** (drizzle-kit migrations), DB at `data/tubescribe.db`
- Transcripts as files: `data/transcripts/<sourceId>/<videoId>.json` **and** `<videoId>.md`
- JSON content: `{ videoId, sourceId, title, url, publishedAt, durationS, language, captionKind, engine, fetchedAt, segments[{text,startMs,endMs}], fullText }`
- Tables: sources, videos, jobs, job_items, chunks, bots, bot_sources (M2M), chats, messages, settings
- Vectors: **sqlite-vec** in the same DB file (`vec_chunks` virtual table)

## Domain

- Single-user, **no auth**
- Source kinds: `channel | playlist | video`
- Bot = name + system prompt + per-bot model picker (live list from OpenRouter's public `/api/v1/models`) + attached sources (M2M)

## LLM and retrieval

- **OpenRouter** via Vercel AI SDK v7 (`@openrouter/ai-sdk-provider`); key: `OPENROUTER_API_KEY` in server `.env` only (no key management in the UI)
- Retrieval: ~500-token chunks, 10% overlap, aligned to transcript segment timestamps; each chunk stores `videoId, sourceId, title, startMs, endMs` for citations
- Default embedding model `openai/text-embedding-3-small` (configurable); chunks keyed to **video** (not bot); retrieval = top-k cosine over the bot's attached sources only
- Embedding runs automatically as a job chained after each extraction job; per-video `embeddedAt`; manual reindex per source
- Chat: **streaming** (`streamText` server + `useChat` web), **persisted** history (chats + messages tables), **citations** as clickable title + timestamp chips linking `youtube.com/watch?v=...&t=123s`

## Frontend

- Tailwind v4 + shadcn/ui, react-router v7, react-hook-form + zod
- Pages: `/sources` (list + smart add input), `/sources/:id` (video grid, per-video status, progress, re-extract / reindex / delete), `/bots` (list + create/edit form), `/bots/:id` (chat + history sidebar), `/settings` (default model pickers only), `/` → `/sources`
- Global job progress indicator in the header (polled)

## Quality and ops

- Tests: unit (URL parser, chunker, backoff, schemas) + server integration (supertest, youtubei.js and OpenRouter mocked via injected clients, recorded fixtures) + a few web component tests; no e2e
- Scripts: `dev`, `build`, `start`, `test`, `lint`, `format`, `typecheck`, `db:migrate`
- **Dockerfile + docker-compose** with a `data/` volume
- README.md, AGENTS.md, `.gitignore` (`node_modules`, `dist`, `data/`, `.env`); no license (private project)
