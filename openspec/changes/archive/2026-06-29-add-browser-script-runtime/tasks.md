## 1. Tool Contract

- [x] 1.1 Extend `BrowserAction` and browser tool schema with a high-privilege script action.
- [x] 1.2 Add shared request/response types for script source, optional args, timeout, result, and script error metadata.
- [x] 1.3 Update the browser tool executor so script payloads are forwarded into `BrowserManager`.

## 2. Browser Runtime Injection

- [x] 2.1 Add a script action dispatcher in `electron/server/browser-manager.ts`.
- [x] 2.2 Ensure a shared browser session exists before script execution begins.
- [x] 2.3 Inject live `BrowserView`, `webContents`, raw debugger/CDP access, `browserManager`, and Electron/Node runtime objects into the Electron-side script context.
- [x] 2.4 Keep script execution on the same browser action queue used by fixed actions and `run`.

## 3. Execution Semantics

- [x] 3.1 Execute high-privilege browser scripts through an async Electron-side service-JavaScript harness.
- [x] 3.2 Add configurable timeout handling for script execution.
- [x] 3.3 Capture thrown exceptions and return structured failure details to the Agent.
- [x] 3.4 Serialize script return values, and fall back to readable type/inspect output when raw Electron objects cannot be JSON-serialized.
- [x] 3.5 Ensure Agent-authored scripts can call BrowserView APIs and raw CDP commands without being forced back through fixed browser actions.

## 4. Session Coexistence

- [x] 4.1 Verify that script actions mutate the same shared session used by `snapshot`, `resolve`, fixed actions, `run`, and screenshot.
- [x] 4.2 Preserve the current DOM-first + AX tree + stable ref + stale re-resolution path for standard controls.
- [x] 4.3 Allow follow-up fixed actions, `snapshot`/`resolve`, and `run` calls to observe state changes caused by scripts.

## 5. Orchestration and Guidance

- [x] 5.1 Update browser orchestration guidance so ordinary DOM controls remain DOM-first by default.
- [x] 5.2 Add guidance that explicit raw browser-runtime requests, raw CDP page-control tasks, canvas/runtime-debug tasks, and BrowserView programming tasks may use the high-privilege script action.
- [x] 5.3 Update browser-facing docs to explain that the new high-privilege script action executes Electron-side service JS and can directly control `BrowserView`.
- [x] 5.4 Update browser-facing docs so standard control resolution is described as AX tree + stable ref + stale re-resolution, not MiniLM/vector matching.

## 6. Verification

- [x] 6.1 Verify a script can read current URL, title, and loading state from `webContents`.
- [x] 6.2 Verify a script can execute page JavaScript through `webContents.executeJavaScript(...)` and return the result.
- [x] 6.3 Verify a script can directly call BrowserView APIs such as reading current bounds or visibility state.
- [x] 6.4 Verify a script can directly drive raw CDP or input events for canvas-style interaction scenarios.
- [x] 6.5 Verify non-serializable return values are still surfaced to the Agent in readable form.
- [x] 6.6 Verify script timeouts and thrown exceptions are returned as explicit failures.
- [x] 6.7 Verify existing DOM + AX tree + stable ref + stale re-resolution behavior still works for ordinary control tasks after the script action is added.
