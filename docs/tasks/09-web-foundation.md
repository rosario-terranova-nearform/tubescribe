# Task 09: Web foundation: Tailwind, shadcn, router, query

**Status**: pending
**Depends on**: 01, 02

## Goal

Bootable React app with the design system, routing skeleton, and typed data layer. No feature pages yet.

## Scope

`apps/web/`:

- Tailwind CSS v4 (`@tailwindcss/vite`)
- shadcn/ui init (`components.json`, base theme) + components: button, input, textarea, select, checkbox, card, dialog, badge, progress, skeleton, sonner
- `src/router.tsx`: react-router v7 routes: `/` → redirect `/sources`, `/sources`, `/sources/:id`, `/bots`, `/bots/new`, `/bots/:id/edit`, `/bots/:id` (chat), `/settings`
- `src/api/client.ts`: fetch wrapper: base `/api`, zod-parses responses with `@tubescribe/shared` schemas, normalizes errors to the shared error shape
- TanStack Query client: sensible defaults + `refetchInterval` helpers for polling jobs
- `src/components/AppLayout.tsx`: header nav (Sources, Bots, Settings) + `GlobalJobIndicator` (polls `GET /api/jobs` every 3 s, hidden when idle; real job data wires in after task 06, stub is fine here)
- Vite proxy `/api` → :3001 (from task 01, verify)

## Key decisions

- react-router v7 (not TanStack Router); react-hook-form + zod resolvers for all forms
- Every response parsed through shared zod schemas: schema drift fails fast in dev

## Acceptance criteria

- [ ] All routes render placeholder pages under `AppLayout` with working nav
- [ ] API client unit test with mocked fetch (success + shared error shape)
- [ ] `pnpm build`, `pnpm test`, `pnpm lint` green
