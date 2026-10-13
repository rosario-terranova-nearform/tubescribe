# Task 08: Bots + chat REST API

**Status**: done (2026-10-13)
**Depends on**: 07

## Goal

Bots CRUD, OpenRouter model catalog proxy, and the streaming chat endpoint with retrieval and citations.

## Scope

`apps/server/src/`:

- `routes/bots.ts`: CRUD; create/edit attaches sources (M2M via `bot_sources`); fields: `name`, `systemPrompt`, `modelOverride` (nullable, falls back to settings default)
- `routes/models.ts`: `GET /api/models` proxies OpenRouter's public model list (`https://openrouter.ai/api/v1/models`, cached 1 h in memory); `GET /api/models?type=embedding` lists embedding models (`/api/v1/embeddings/models`); never leaks the API key
- `routes/chats.ts`: list/create/delete chats per bot; list messages
- `chat.ts`: `POST /api/chats/:id/messages`:
  1. persist user message
  2. retrieve top-8 chunks for the bot's sources (task 07 `retrieve`)
  3. build prompt: bot system prompt + numbered context blocks `[1] title @ mm:ss ...`
  4. `streamText` with bot model (`modelOverride` or settings default), AI SDK data-stream response (compatible with `useChat`)
  5. persist assistant message + citation metadata `[{ n, videoId, title, startMs, url }]`

## Key decisions

- The OpenRouter key never appears in any response; chat calls are server-side only
- Citations are stored on the assistant message so history renders them without re-retrieval
- Empty retrieval (source not embedded yet) still answers, with a note that no corpus context was found

## Acceptance criteria

- [x] Integration tests with a mocked AI SDK provider: stream completes, both messages persisted, citations attached to assistant message
- [x] Retrieval scoping test: a bot only sees chunks from its attached sources
- [x] Bots CRUD + validation errors (400 shared schema), 404 paths
- [x] `pnpm test` green

## As built (2026-10-13)

Two points were settled with the user where this file conflicted with the shared contracts from task 02:

- **Bot model**: implemented as nullable `modelOverride` as written here (bots.model → model_override, migration `0002_bots-model-override.sql` rebuilds the table to drop NOT NULL; chat resolves `modelOverride ?? settings.defaultChatModel ?? config default`). `UpdateBotRequestSchema` is a *true* partial (omitted fields stay unchanged; `modelOverride: null` clears the override).
- **Chat stream protocol**: kept the shared NDJSON contract (`SendMessageChunkSchema`: `citations` → `delta`* → `done`/`error` on `POST /api/chats/:id/messages`), *not* the AI SDK data-stream format — task 12's web client must parse NDJSON (or wrap it in a custom `useChat` transport).
- Citations use the shared `CitationSchema` shape (`{ videoId, sourceId, title, startMs, endMs, text }`), not the looser `{ n, videoId, title, startMs, url }` sketched above: `n` is the array position (matching the `[n]` context blocks) and the URL is derivable (`youtube.com/watch?v=<videoId>&t=<startMs/1000>s`).
