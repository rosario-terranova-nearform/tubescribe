# Task 13: Settings UI

**Status**: pending
**Depends on**: 03, 09

## Goal

The `/settings` page: default models, managed in the DB-backed settings.

## Scope

`apps/web/src/`:

- `SettingsForm`: default chat model picker (`GET /api/models`), default embedding model picker (`GET /api/models?type=embedding`); save via `PUT /api/settings`; saved-indicator (sonner toast)
- Info card: the OpenRouter API key is configured server-side via `.env` (`OPENROUTER_API_KEY`); show only whether the server reports one configured (boolean from settings endpoint, never the key itself)
- Warning when the embedding model is changed: requires reindexing all sources (copy + link to Sources page)

## Key decisions

- No key management in the UI, by design (see `docs/DESIGN.md`)
- Settings values validated with the shared settings schema on both ends

## Acceptance criteria

- [ ] Save round trip works against the dev server; invalid model id rejected with shared error shape
- [ ] Embedding-model-change warning renders
- [ ] `pnpm build`, `pnpm test` green
