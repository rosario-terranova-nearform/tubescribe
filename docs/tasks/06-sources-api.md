# Task 06: Sources REST API

**Status**: done (2026-10-09)
**Depends on**: 05

## Goal

REST endpoints powering the sources UI: resolve, create, list, detail, re-extract, delete, plus job status.

## Scope

`apps/server/src/routes/`:

- `POST /api/sources/resolve`: pasted string → parse (shared parser) → resolve via youtube service → preview `{ kind, identifier, title, thumbnailUrl, videoCount?, duplicate: boolean }`
- `POST /api/sources`: validate (shared schema), insert source, enqueue extraction job; 409 on duplicate (normalized identifier)
- `GET /api/sources`: list with video counts + aggregated status
- `GET /api/sources/:id`: detail + paginated videos (id, title, status, language, captionKind, engine, error)
- `POST /api/sources/:id/reextract`: re-enqueue failed items (or all with `?all=true`)
- `DELETE /api/sources/:id`: delete row, its videos/chunks, and its `data/transcripts/<sourceId>/` folder
- `GET /api/jobs`: active + recent jobs with progress counts (polled by the web header)
- `GET /api/jobs/:id`: single job detail

## Key decisions

- All request/response bodies validated with `@tubescribe/shared` schemas
- Duplicate = same normalized identifier (channel UC id, playlist id, video id), regardless of input spelling

## Acceptance criteria

- [ ] Integration tests (supertest, mocked youtube service): resolve → create → job enqueued → videos listed after fake extraction
- [ ] Duplicate create returns 409 with the shared error schema
- [ ] Invalid bodies return 400 with the shared error schema
- [ ] Delete removes files from disk
- [ ] `pnpm test` green
