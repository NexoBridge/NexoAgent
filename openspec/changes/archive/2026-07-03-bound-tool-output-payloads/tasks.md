## 1. Output Contract

- [x] 1.1 Define shared types for bounded tool output: `summary`, `preview`, `rawRef`, `artifact`, `stats`, and truncation reason.
- [x] 1.2 Define default inline, preview, raw artifact, and script-specific size limits.
- [ ] 1.3 Decide raw output retention policy and cleanup lifecycle.

## 2. Runtime Guard

- [x] 2.1 Add a pure helper to normalize tool output before it enters model messages, SSE, or message blocks.
- [x] 2.2 Store oversized raw output out-of-band and return a compact model payload.
- [x] 2.3 Ensure compaction summaries preserve raw references and do not re-inline full output.
- [x] 2.4 Preserve existing small tool output behavior.

## 3. Browser Script Output

- [x] 3.1 Route capture-like `action="script"` results into `scriptCache` before building the model payload.
- [x] 3.2 For oversized non-capture script returns, store raw output as a temporary tool artifact.
- [x] 3.3 Return actionable script summaries containing cache keys, counts, URL/method/status samples, TTL, and cleanup hints.
- [x] 3.4 Add prompt guidance that scripts should return concise summaries and cache/artifact references for large data.

## 4. UI and API

- [x] 4.1 Add a backend route or artifact API to read raw tool output by reference.
- [x] 4.2 Update tool call UI to display summary/preview by default.
- [x] 4.3 Lazy-load raw output only when the user expands or downloads it.
- [x] 4.4 Show size/truncation metadata so users understand why full output is not inline.

## 5. Verification

- [x] 5.1 Verify small tool outputs remain inline.
- [x] 5.2 Verify oversized outputs produce compact model payload plus raw reference.
- [x] 5.3 Verify `browser_action.script` capture output returns cache summaries instead of full logs.
- [x] 5.4 Verify raw output can be loaded from UI/API by reference.
- [x] 5.5 Verify long tool output no longer inflates prompt token estimates or crashes the next model turn.
