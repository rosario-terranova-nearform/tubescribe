# Task 05: Extraction engine: job queue, worker, file writer

**Status**: done (2026-10-08)
**Depends on**: 04

## Goal

Durable, resumable extraction: SQLite-backed job queue, a worker with bot-detection defenses, and the JSON + MD file writer.

## Scope

`apps/server/src/jobs/`:

- `queue.ts`: create job + one `job_items` row per discovered video; claim next pending item; per-item checkpoint updates
- `worker.ts`: loop started with the server process; on boot, resumes `pending`/`running` jobs; transcript fetch concurrency from env (default 1, max 2); randomized delay between fetches (`TRANSCRIPT_DELAY_MIN_MS` to `MAX_MS`)
- `backoff.ts`: jittered exponential backoff; `TRANSCRIPT_MAX_RETRIES` (default 3); then item marked failed with error, job continues
- `pipeline.ts`: per video: fallback chain youtubei.js → youtubei.js `TV_EMBEDDED` → youtube-transcript package; record success `engine`, `language`, `captionKind`; write files; update videos row + item status
- `files.ts`: writes `<DATA_DIR>/transcripts/<sourceId>/<videoId>.json` and `.md` (JSON shape per `docs/DESIGN.md`)
- `status.ts`: aggregate counts per source/job (pending / fetched / failed)

## Key decisions

- A failed video never fails a job; failures are data (status + error message)
- File writes are atomic (write temp + rename)
- Keep every knob reading from `config.ts`, no hardcoded delays

## Acceptance criteria

- [ ] Unit tests: backoff timing bounds, JSON/MD writer (shape + atomic rename), delay bounds respected
- [ ] Integration tests with fake engines (always-ok / flaky-then-ok / always-fail): job completes, statuses correct, files on disk
- [ ] Resume test: kill worker mid-job, restart, pending items continue, fetched items not refetched
- [ ] `pnpm test` green
