---
name: workflow
description: Manage multi-step tasks with a live todo list, preserve state across steps, and verify before declaring done.
---

# Workflow

## Starting a Workflow

1. Use **TodoWrite** to create a task list immediately — one item per distinct step, all set to `pending`.
2. Mark exactly one item `in_progress` at a time. Mark it `completed` before moving to the next.
3. For tasks with unknowns, add a discovery step first before the implementation steps.

## During Execution

- **State is explicit**: if a step produces output needed by a later step (a filename, an ID, a value), write it down in the response — don't rely on memory.
- **Don't skip verification**: after each step, confirm the expected output is present before continuing.
- **Surface blockers early**: if a step fails or reveals a dependency, update the todo list and report before proceeding.
- **Parallel where safe**: independent steps can be done in the same turn; list them together in the todo before starting.

## Finishing

- Only mark the workflow complete when every step is verified, not just run.
- Report what was done, what was skipped (and why), and any follow-up actions needed.
- If interrupted mid-task, summarize the current state clearly so work can resume.

## Long-running / Multi-session Tasks

- At the start of each session, re-read relevant files or run a status check before continuing — don't trust memory of prior context.
- For tasks spanning multiple turns, keep the todo list updated so the current state is always visible.
