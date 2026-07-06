## Why

`browser_action.action="script"` currently returns the script result together with a full browser snapshot. On data-heavy pages this makes different script calls look repeated because each response includes the same page history, element list, and readable page text. The actual `script.result` may be different, but it is buried behind a stable snapshot payload that can be hundreds of KB.

This also weakens the short-lived capture cache work: even when request samples are stored in `scriptCache`, the tool response can still send unrelated repeated page state back to the model and UI.

## What Changes

- Make `action="script"` return only `ok` plus the current script execution payload.
- Always omit full `history`, `elements`, readable page `text`, and resolver state from script tool output.
- Do not add request parameters for switching script output back to full state.
- Keep the internal post-script snapshot refresh so later browser actions still see fresh refs and page state.
- Require full page state to be fetched through a separate `browser_action.action="snapshot"` call when it is actually needed.

## Impact

- `electron/server/browser-manager.ts`: keep internal post-script state fresh while removing full page state from script responses.
- `electron/server/tools/executors.ts`: format script tool output as `{ ok, script }` and remove script state include flag forwarding.
- `electron/server/tool-output.ts`: avoid misleading `snapshot elements: 0` summaries for script responses.
- `electron/server/agent.ts` and `nexo/tools.json`: document fixed script-only response behavior.
- `src/shared/types.ts`: remove script state include flags and omission metadata.
- Verification scripts cover fixed script-only tool output and output summaries.

## Non-Goals

- Do not change ordinary `snapshot`, `click`, `type`, `resolve`, or navigation responses.
- Do not provide a parameter to make `script` return full page state.
- Do not remove access to full state; it remains available through a separate `snapshot` action.
- Do not make `scriptCache` a long-term memory store.
