# Task 01: Monorepo scaffold

**Status**: done (2026-10-03)
**Depends on**: 00

## Goal

Bootable pnpm workspace with `apps/server`, `apps/web`, `packages/shared`, all tooling green.

## Scope

- Root: `package.json` (`private`, `"type": "module"`, `engines: node >= 22`, `packageManager: pnpm@10`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `tsconfig.base.json` (strict, ESM), `biome.json`, dev deps (`concurrently`, `typescript`, `tsx`, `vitest`, `vitest` config, `@biomejs/biome`)
- Root scripts: `dev` (server + web via concurrently), `build`, `start`, `test`, `test:watch`, `lint`, `format`, `typecheck`
- `apps/server`: Express + pino + dotenv deps; `src/index.ts` with `GET /api/health` returning `{ ok: true }`; `tsx watch` dev script; tsconfig extending base (NodeNext)
- `apps/web`: Vite react-ts scaffold; `vite.config.ts` proxies `/api` to `http://localhost:3001`
- `packages/shared`: name `@tubescribe/shared`, proper `exports`, stub `src/index.ts`

## Key decisions

- ESM everywhere; TS strict; no Nx/Turborepo
- Server tsconfig: `module/moduleResolution: NodeNext`; web: `bundler`
- `.env` handling comes in task 03; here just document `cp .env.example .env`

## Acceptance criteria

- [ ] `pnpm install` succeeds from clean clone
- [ ] `pnpm dev` boots server on :3001 (`/api/health` answers) and web on :5173
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all green
- [ ] `pnpm build && pnpm start` runs the built server
