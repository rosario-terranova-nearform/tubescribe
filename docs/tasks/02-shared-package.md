# Task 02: Shared package: types, zod schemas, source parser

**Status**: pending
**Depends on**: 01

## Goal

`@tubescribe/shared` becomes the single source of truth for API contracts and the smart source-input parser.

## Scope

`packages/shared/src/`:

- `domain.ts`: `SourceKind = channel | playlist | video`, source type filter (uploads / shorts / live flags), `VideoStatus` (pending / fetched / failed / embedded), `JobStatus`, `CaptionKind` (manual / asr), entity types (Source, Video, Job, Bot, Chat, Message, Settings)
- `errors.ts`: shared API error schema (`{ error: { code, message, details? } }`)
- `api/*.ts`: request/response zod schemas per endpoint group (resolve-source, sources, jobs, bots, models, chats, settings)
- `source-input.ts`: parser from pasted string to `{ kind, identifier }`:
  - `@handle`, `UC...` id, `youtube.com/channel/...`, `/user/...`, `/c/...`, `/@...`
  - playlist: `list=` param or bare `PL...`/`UU...` id
  - video: `watch?v=`, `youtu.be/`, `/shorts/`, bare 11-char id
  - throws a typed `SourceInputError` on garbage
- `index.ts` exports

## Key decisions

- Parser lives in shared so the web app can pre-validate before calling `/api/sources/resolve`
- zod v4; every API body/response has a schema here, no ad-hoc types in server or web

## Acceptance criteria

- [ ] Unit tests for the parser: 10+ cases including shorts URL, youtu.be, bare UC id, `list=`, mixed garbage, trailing whitespace
- [ ] Schema round-trip tests for the main API contracts
- [ ] `pnpm test` green
