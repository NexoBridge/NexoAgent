---
name: coding
description: Use for any coding task: reading, editing, debugging, reviewing, refactoring, or verifying application code, build scripts, configs, and generated outputs. Read surrounding code first, make small verified changes, match local patterns, and do not declare completion until local verification passes.
---

# Coding

## Default Loop

1. Read the target file and closely related files before touching anything.
2. Check the repo's build and test scripts so you know the right verification command.
3. Make the smallest change that solves the request.
4. Re-read the diff before and after editing.
5. Verify locally before declaring the work done.

## What To Read First

- Inspect the target module and nearby modules that define its types, helpers, routes, or shared state.
- Use `rg` and `rg --files` for fast discovery when searching code.
- Check the workspace root for build tooling such as `package.json`, `Cargo.toml`, `pom.xml`, or `Makefile`.
- Identify the impact area: frontend, server, shared types, build config, packaging, or docs/skills.

## Making Changes

- Prefer targeted edits over full rewrites.
- Keep one concern per change.
- Preserve user edits in dirty worktrees. Read the current diff before editing a file that already has changes.
- Prefer existing helpers, local patterns, and module boundaries over new abstractions.
- Use structured parsing instead of string hacks when the data is structured.
- For multi-file changes, outline the plan briefly before starting.
- If the request spans multiple areas, make the smallest safe change in each area rather than one broad rewrite.

## Git And Filesystem Safety

- Never run git restore, git checkout -- <path>, git reset, or any other destructive git command unless the user explicitly asks for it.
- Do not suggest git restore or checkout as a fix for broken work.
- If an edit breaks a file, repair the current file in place after reading the surrounding structure.
- Verify any recursive delete or move target path before using it.

## Frontend And UI

- Match the existing design system, spacing, and component patterns.
- Use the right control for the job: icons for icon buttons, segmented controls for mode switches, toggles for binary state, and menus or tabs for option sets.
- Keep operational UIs dense, readable, and utilitarian.
- Make sure text fits inside its container on mobile and desktop.
- Avoid introducing decorative UI that does not help the task.

## Verification

AI review is useful, but it is not a compiler. A planner/executor/verifier pass can miss syntax, import, JSX, template, selector, and packaging errors. Code is not done until the changed project has been verified by local tooling.

1. Run the smallest verification command that covers the changed area.
2. If runtime behavior changed, run the most relevant test or build command too.
3. Inspect the command output, not only the exit code. Treat `SyntaxError`, `Failed to compile`, `ERROR`, unresolved imports, and missing files as failures even if the process exits 0.
4. If verification fails, fix the code and rerun the same command before presenting the result.
5. If verification cannot be run, say exactly why and name the command that should be run later.

## Verification Gate For Generated Code

When the task creates or edits application code:

- Reopen the changed files or inspect the relevant diff before running the build.
- Look for placeholders, malformed selectors, broken JSX/template structure, duplicated component insertions, missing quotes, missing imports, and incorrect file paths.
- Run verification from the target project root, not from the agent app root, when the user is asking about another workspace.
- For TypeScript/React/Vue/Taro/mini-program work, prefer a command that parses the changed files: `npm run typecheck`, `tsc --noEmit`, the framework build, or the project-specific package command.
- If the user asks to package or build, run that command and report the real result, including the working directory and output directory.
- Do not present generated code as integrated or complete until this gate passes, unless the user explicitly asked to skip verification.

For this Nexo Agent project, prefer these commands:

- Frontend/UI, Electron/server, shared types, bundled metadata, skills/tools definitions, or cross-cutting changes: `npm run typecheck`.
- Runtime behavior that needs compiled output: `npm run build`.
- Planner/executor routing behavior: `npm run verify`.
- Packaging/build pipeline behavior: `npm run build`; run OS package commands only when the user asks for distributables.

For Taro mini-program projects, prefer the project build command such as `npm run build:weapp` when available. That build is the minimum reliable check for generated page/component code because it catches JSX/TSX syntax, selector strings, platform component imports, and packaging issues.

Do not use the long-running dev command (`npm run dev`) as verification because it does not exit.

## Review Mode

- If the user asks for a review, lead with findings.
- Prioritize bugs, regressions, missing tests, and behavioral mismatches.
- Keep summaries brief and put them after the findings.

## Communicating Results

- State what changed and why.
- State the verification command or commands run and whether they passed.
- Reference changed locations as `file:line` when helpful.
- Call out tradeoffs only when there is a real alternative.
