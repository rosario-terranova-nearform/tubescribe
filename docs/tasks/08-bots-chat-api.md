# Task 08: Bots + chat REST API

**Status**: pending
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

- [ ] Integration tests with a mocked AI SDK provider: stream completes, both messages persisted, citations attached to assistant message
- [ ] Retrieval scoping test: a bot only sees chunks from its attached sources
- [ ] Bots CRUD + validation errors (400 shared schema), 404 paths
- [ ] `pnpm test` green
