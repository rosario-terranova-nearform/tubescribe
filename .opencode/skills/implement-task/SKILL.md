---
name: implement-task
description: Use when the user asks to implement, build, or work on a numbered tubescribe task from docs/tasks/ (e.g. "implement task 05", "do the next task", "continue with the tasks"). Reads the task file, verifies dependencies, implements to the acceptance criteria, and updates task status.
---

# Implement a tubescribe task

Implementation tasks live in `docs/tasks/NN-*.md` with an index in `docs/tasks/README.md`.

## Workflow

1. Read `AGENTS.md` (conventions) and skim `docs/DESIGN.md` (source of truth for decisions).
2. Read `docs/tasks/README.md` and the requested task file (or pick the lowest-numbered `pending` task if the user said "next task").
3. Check the task's **Depends on**: every dependency must be `done`. If not, tell the user and stop (or propose doing the blocking task first).
4. Implement exactly the task's **Scope**, nothing more. Follow its **Key decisions**; if one conflicts with reality, stop and ask the user instead of improvising.
5. Write the tests listed in the **Acceptance criteria**, then run `pnpm typecheck`, `pnpm lint`, and `pnpm test` (or the relevant subset while iterating). Everything must pass.
6. When done, in the same change: set the task file's `**Status**` to `done (YYYY-MM-DD)` and update the index table in `docs/tasks/README.md`.
7. If structure, commands, or conventions changed, update `AGENTS.md` too.
8. Report a short summary: what was built, test results, anything deferred.

## Rules

- Never do live network calls to YouTube or OpenRouter in tests; mock at the injected client boundaries (see task 04 conventions).
- Never commit secrets, `.env`, or anything under `data/`.
- No git commits unless the user explicitly asks.
- If you notice missing scope (a needed endpoint, a missing component), do not silently expand: propose a new task via the `new-task` skill or ask the user.
