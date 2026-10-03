# Task 14: Docker, prod serving, README, release

**Status**: pending
**Depends on**: all previous tasks

## Goal

One-command run (with and without Docker), full docs, initial commit.

## Scope

- Prod serving: Express serves `apps/web/dist` statically when present (SPA fallback to `index.html`, excluding `/api`)
- `Dockerfile`: `node:22-bookworm-slim`, corepack pnpm, workspace install, `pnpm build`, `pnpm start`; relies on prebuilt `better-sqlite3` and `sqlite-vec` binaries (document the `apt install python3 make g++` fallback in comments)
- `docker-compose.yml`: `app` service, `ports: 3001:3001`, `env_file: .env`, volume `./data:/app/data`
- `.dockerignore` (`node_modules`, `data`, `.env`, `dist`)
- `README.md`: what it is, screenshots placeholder, prerequisites (Node >= 22 or Docker), quickstart (dev + Docker), `.env` reference, usage walkthrough (add source → create bot → chat), troubleshooting (bot-detection knobs, reindex after embedding model change)
- `AGENTS.md`: final sync (commands, structure, conventions as built)
- Verify fresh-clone flow end to end
- **Initial git commit** (ask the user first; per AGENTS.md no commits without explicit approval)

## Acceptance criteria

- [ ] `pnpm build && pnpm start` serves the full app on :3001
- [ ] `docker compose up --build` works on this machine; data persists in `./data`
- [ ] README verified against a fresh clone (or a clean directory)
- [ ] Full check suite green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
