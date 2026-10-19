# tubescribe

Local, single-user app: paste a YouTube channel / playlist / video, build a local transcript corpus, and chat with LLM "bots" grounded on chosen sources (via OpenRouter) with clickable timestamp citations.

<!-- screenshots: sources list, bot chat with citation chips -->

Everything runs and stays on your machine: transcripts as JSON + Markdown files, metadata + vector embeddings in a local SQLite database. The only external calls are to YouTube (keyless, via youtubei.js) and OpenRouter (chat + embeddings).

## Prerequisites

- **Node >= 22** with **pnpm 10** (the repo pins its version via `packageManager`; [corepack](https://nodejs.org/api/corepack.html) fetches it: `corepack enable`)
- or **Docker** (compose plugin) — no local Node needed
- An [OpenRouter API key](https://openrouter.ai/keys) for chat + embeddings

## Quick start

### Development

```bash
cp .env.example .env       # then add your OPENROUTER_API_KEY (server-only)
pnpm install
pnpm dev                   # API on :3001, web on :5173 (proxies /api)
```

Open http://localhost:5173.

### Production (no Docker)

```bash
pnpm build
pnpm start                 # serves API + built web app on http://localhost:3001
```

### Docker

```bash
cp .env.example .env       # then add your OPENROUTER_API_KEY
docker compose up --build  # http://localhost:3001
```

The SQLite database and transcript corpus persist in `./data` on the host (bind-mounted into the container). Note the container runs as root, so on Linux `./data` files may be root-owned (on macOS/Windows Docker Desktop this is mapped transparently).

## `.env` reference

All variables are read by the **server only**; the key is never sent to the web client.

| Variable | Default | What it does |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | OpenRouter key (chat + embeddings). Required for both. |
| `PORT` | `3001` | API/prod port |
| `DATA_DIR` | `./data` | Where the SQLite DB + transcript files live (relative to repo root) |
| `DEFAULT_CHAT_MODEL` | `openai/gpt-4o-mini` | Chat model when a bot has no override |
| `DEFAULT_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Embedding model for the corpus |
| `TRANSCRIPT_CONCURRENCY` | `1` | Parallel transcript fetches (max 2 — bot-detection defense) |
| `TRANSCRIPT_DELAY_MIN_MS` / `TRANSCRIPT_DELAY_MAX_MS` | `1000` / `3000` | Randomized delay between transcript fetches |
| `TRANSCRIPT_MAX_RETRIES` | `3` | Retries per video before it's marked failed (job continues) |
| `NODE_ENV` / `LOG_LEVEL` | `development` / `info` | Server runtime / pino log level |

## Usage

1. **Add a source** on the Sources page: paste a channel (`@handle`, `UC…`, or URL), playlist, or video URL. Confirm the resolved card — extraction starts automatically (per-source type filter: uploads / shorts / live). Watch progress in the header.
2. **Create a bot** on the Bots page: name, system prompt, model override (optional), and the sources it grounds on.
3. **Chat** on the bot's page: answers stream in and cite the transcript chunks they used as `[n] title @ mm:ss` chips that open the video at that timestamp. History is persisted per chat in the sidebar.

## Troubleshooting

- **Videos stuck/failed during extraction ("bot detection", `LOGIN_REQUIRED`, 429s):** YouTube rate-limits aggressively. Keep `TRANSCRIPT_CONCURRENCY=1` and the 1–3 s delays, retry failed videos later via **Re-extract** on the source page. Each video falls back through youtubei.js → youtubei.js TV client → youtube-transcript before failing.
- **Answers say "no corpus context" / no citations:** the source's videos aren't embedded yet. Embedding runs automatically after extraction; check the source page, or use **Reindex**.
- **Changed the embedding model in Settings:** existing chunks keep the old vectors — **Reindex** every source afterwards (the Settings page warns about this).
- **`pnpm start` shows only the API:** run `pnpm build` first — the server serves `apps/web/dist` when it exists.

## Development

### Layout

```
apps/
  server/    Express + TS API @ :3001 (serves the built web app in prod)
  web/       Vite + React + TS @ :5173 (proxies /api to :3001)
packages/
  shared/    zod schemas + types shared by both apps
docs/
  DESIGN.md        source of truth for design decisions
  tasks/           numbered implementation plan
```

### Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | start server (`tsx watch`) and web (`vite`) together |
| `pnpm build` | `tsc` for server + shared, then `vite build` for web |
| `pnpm start` | run the built server; also serves the built web app on :3001 |
| `pnpm test` / `pnpm test:watch` | vitest across all packages |
| `pnpm lint` / `pnpm format` | biome check / biome format --write |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm db:migrate` | drizzle-kit migrations |

### Testing

Unit + integration tests (supertest) with YouTube and OpenRouter mocked at injected client boundaries; fixtures under `__fixtures__/`; no live network in tests.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the settled design and [`AGENTS.md`](AGENTS.md) for contributor conventions.
