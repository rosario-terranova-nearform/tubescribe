# Task 00: Environment setup

**Status**: done (2026-09-25)
**Depends on**: -

## Goal

Prepare the repo for agent-driven development with opencode.

## What was done

- `opencode.json` with `$schema`, `instructions: [AGENTS.md]`, and Context7 MCP (remote, anonymous) for up-to-date library docs
- `AGENTS.md` (conventions, commands, gotchas, rules)
- `docs/DESIGN.md` (settled design, source of truth)
- `docs/tasks/` (this plan)
- `.opencode/skills/implement-task` and `.opencode/skills/new-task`
- `.gitignore`, `.env.example`
- `git init` (initial commit happens in task 14)

## Notes

- opencode loads config once at startup: restart opencode after editing `opencode.json` or `.opencode/`.
