# Implementation tasks

Work in dependency order. Use the `implement-task` skill (or read the task file fully) before starting. When a task is done, set its `**Status**` line to `done (YYYY-MM-DD)` and update this index in the same change.

Design source of truth: [`../DESIGN.md`](../DESIGN.md). Never deviate without asking the user.

| # | Task | Status | Depends on |
| --- | --- | --- | --- |
| 00 | [Environment setup](00-environment-setup.md) | done (2026-09-25) | - |
| 01 | [Monorepo scaffold](01-monorepo-scaffold.md) | done (2026-10-03) | 00 |
| 02 | [Shared package: types, zod schemas, source parser](02-shared-package.md) | done (2026-10-05) | 01 |
| 03 | [Server foundation: config, logger, DB, settings](03-server-foundation.md) | done (2026-10-06) | 01, 02 |
| 04 | [YouTube service: resolution, listing, transcript engines](04-youtube-service.md) | done (2026-10-07) | 03 |
| 05 | [Extraction engine: job queue, worker, file writer](05-extraction-engine.md) | pending | 04 |
| 06 | [Sources REST API](06-sources-api.md) | pending | 05 |
| 07 | [Embeddings pipeline: chunker, sqlite-vec, retrieval](07-embeddings-pipeline.md) | pending | 05 |
| 08 | [Bots + chat REST API](08-bots-chat-api.md) | pending | 07 |
| 09 | [Web foundation: Tailwind, shadcn, router, query](09-web-foundation.md) | pending | 01, 02 |
| 10 | [Sources UI](10-sources-ui.md) | pending | 06, 09 |
| 11 | [Bots UI](11-bots-ui.md) | pending | 08, 09 |
| 12 | [Chat UI](12-chat-ui.md) | pending | 08, 09 |
| 13 | [Settings UI](13-settings-ui.md) | pending | 03, 09 |
| 14 | [Docker, prod serving, README, release](14-docker-and-release.md) | pending | all above |

## Rules

- One task at a time; do not start a task whose dependencies are not `done`.
- Acceptance criteria are the definition of done; all relevant checks (`typecheck`, `lint`, `test`) must pass.
- Keep changes minimal and within the task scope; new ideas become new tasks (use the `new-task` skill).
