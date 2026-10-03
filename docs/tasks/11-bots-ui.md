# Task 11: Bots UI

**Status**: pending
**Depends on**: 08, 09

## Goal

The `/bots` pages: list, create, edit, delete.

## Scope

`apps/web/src/`:

- `BotList`: cards (name, model, attached source count), link to chat and edit
- `BotForm` (create `/bots/new` and edit `/bots/:id/edit`):
  - `name` (required), `systemPrompt` (textarea, required)
  - `ModelPicker`: searchable combobox fed by `GET /api/models` (chat models); empty selection = use global default (label shows what the default is)
  - source attachment: checkbox list of all sources (at least one required)
  - react-hook-form + zod resolver using the shared bot schema
- Delete with confirm dialog

## Key decisions

- Model list comes from the server proxy (OpenRouter key stays server-side); cache the query aggressively (1 h, matches server cache)

## Acceptance criteria

- [ ] Form validation component tests: name required, at least one source, zod errors surface
- [ ] ModelPicker loading / error / empty states tested
- [ ] Manual smoke: create a bot against the dev server
- [ ] `pnpm build`, `pnpm test` green
