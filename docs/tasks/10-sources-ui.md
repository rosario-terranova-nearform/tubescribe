# Task 10: Sources UI

**Status**: pending
**Depends on**: 06, 09

## Goal

The `/sources` and `/sources/:id` pages: add, browse, and monitor extraction.

## Scope

`apps/web/src/`:

- `AddSourceBox`: single paste input → `POST /api/sources/resolve` → confirmation card (kind badge, title, thumbnail, video count, type-filter select with uploads/shorts/live checkboxes) → `POST /api/sources`; handles errors: invalid input (400), duplicate (409, link to existing)
- `/sources` page: source cards (title, kind, counts by status, thumbnail), navigates to detail
- `/sources/:id` page:
  - video grid with per-video status badges (pending / fetched / failed / embedded) + failure tooltip (error message)
  - extraction progress bar, polled via TanStack Query `refetchInterval` (3 s) while a job is active
  - actions: re-extract failed, reindex (confirm dialog), delete (confirm dialog)

## Key decisions

- Polling only while at least one job for this source is active (stop when idle)
- Type filter is chosen at source creation; editing it later means re-extraction (out of scope, note in UI copy)

## Acceptance criteria

- [ ] Component tests for `AddSourceBox` states: idle, resolving, preview, invalid input, duplicate
- [ ] Manual smoke: add a small real channel end-to-end against the dev server, watch progress, inspect `data/transcripts/`
- [ ] `pnpm build`, `pnpm test` green
