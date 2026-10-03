# Task 12: Chat UI

**Status**: pending
**Depends on**: 08, 09

## Goal

The `/bots/:id` chat experience: streaming answers with clickable timestamp citations and persisted history.

## Scope

`apps/web/src/`:

- `ChatPage` (`/bots/:id`): `useChat` (`@ai-sdk/react`) with a transport pointed at `POST /api/chats/:id/messages`; streaming render; markdown for assistant messages (e.g. `react-markdown`); auto-scroll; disabled input while streaming
- `CitationChip`: renders `[n] title @ mm:ss` from message citation metadata, links to `https://youtube.com/watch?v=<id>&t=<seconds>s` in a new tab
- `ChatSidebar`: chats for this bot (newest first), new-chat button, delete; selecting a chat loads its persisted messages (citations included)

## Key decisions

- Citations come from assistant message metadata (persisted server-side), not re-derived client-side
- If the bot has no sources or nothing is embedded yet, show an empty-state hint pointing to the Sources page

## Acceptance criteria

- [ ] `CitationChip` component test (label + `t=` URL)
- [ ] Manual smoke: real question over an extracted source, streaming works, citations link to the right timestamps, history survives reload
- [ ] `pnpm build`, `pnpm test` green
