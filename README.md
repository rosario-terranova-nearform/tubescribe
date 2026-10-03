# tubescribe

Local, single-user app: paste a YouTube channel / playlist / video, build a local transcript corpus, and chat with LLM "bots" grounded on chosen sources (via OpenRouter) with clickable timestamp citations.

Status: scaffold only. See [`docs/DESIGN.md`](docs/DESIGN.md) for the settled design and [`docs/tasks/`](docs/tasks/) for the implementation plan.

## Requirements

- Node >= 22 (we test on 22.x)
- pnpm 10 (the repo pins its version via `packageManager`; corepack will fetch it)

## Quick start

```bash
cp .env.example .env       # add your OPENROUTER_API_KEY (server-only)
pnpm install
pnpm dev                   # server on :3001, web on :5173
```

Then open http://localhost:5173 and call `GET http://localhost:3001/api/health`.

## Layout

```
apps/
  server/    Express + TS API @ :3001
  web/       Vite + React + TS @ :5173 (proxies /api to :3001)
packages/
  shared/    zod schemas + types shared by both apps
docs/
  DESIGN.md        source of truth for design decisions
  tasks/           numbered implementation plan
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | start server (`tsx watch`) and web (`vite`) together |
| `pnpm build` | `tsc -b` for server + shared, then `vite build` for web |
| `pnpm start` | run the built server (also serves the built web app once task 14 lands) |
| `pnpm test` / `pnpm test:watch` | vitest across all packages |
| `pnpm lint` | biome check |
| `pnpm format` | biome format --write |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm db:migrate` | drizzle-kit migrations (lands in task 03) |

## Conventions

See [`AGENTS.md`](AGENTS.md) if you're an agent or contributor.
