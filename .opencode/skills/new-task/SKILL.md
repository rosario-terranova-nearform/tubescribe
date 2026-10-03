---
name: new-task
description: Use when creating a new implementation task file under docs/tasks/ for tubescribe (e.g. "add a task for X", "create a task to ...", "this needs a follow-up task"). Follows the project task template and updates the index.
---

# Create a tubescribe task file

Task files live in `docs/tasks/NN-kebab-title.md` and are indexed in `docs/tasks/README.md`.

## Workflow

1. Read `docs/tasks/README.md` to find the next free number (two digits, zero-padded) and existing dependencies.
2. Create the file with this exact structure:

```markdown
# Task NN: Title

**Status**: pending
**Depends on**: NN, MM (or `-`)

## Goal

One paragraph: what exists when this task is done.

## Scope

- Files, directories, endpoints, components to create or change

## Key decisions

- Relevant constraints from docs/DESIGN.md or new micro-decisions the implementer must not re-litigate

## Acceptance criteria

- [ ] Checkable items, including which tests must exist
- [ ] `pnpm test` (and typecheck/lint) green
```

3. Add a row to the index table in `docs/tasks/README.md` with the right **Depends on** column.
4. Keep scope small: a task is one coherent unit an agent can finish in one session. Split rather than bloat.
