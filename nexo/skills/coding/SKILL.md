---
name: coding
description: Read surrounding code first, make small verified changes, match existing patterns, and explain tradeoffs.
---

# Coding

## Before Writing Code

1. **Read first** — read the target file and any closely related files before touching anything. Match comment density, naming conventions, and idioms of the surrounding code.
2. **Check build tools** — look for `package.json`, `Cargo.toml`, `pom.xml`, `Makefile`, etc. to know the correct build and test commands before running anything.
3. **Minimal scope** — implement only what is asked. No extra abstractions, no defensive code beyond what the task requires.

## Making Changes

- Prefer **Edit** over full rewrites. Only rewrite a file if the change touches most of it.
- One concern per change. Don't clean up unrelated code in the same diff.
- Use secure coding defaults: parameterized queries, input validation, proper error handling.
- For multi-file changes, outline the plan briefly before starting.

## Verification

After every code change:
1. Run the project's **build or compile** step.
2. If build passes, run **relevant tests**.
3. If either fails, fix before presenting the result — never show broken code as done.

## Communicating Results

- State what was changed and why, briefly.
- Call out **tradeoffs** when a choice has real alternatives (performance vs. readability, etc.).
- Reference changed locations as `file:line` (clickable).
- If tests were skipped (e.g., environment constraints), say so explicitly.
