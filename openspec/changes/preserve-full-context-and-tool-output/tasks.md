## 1. Request Intake

- [x] 1.1 Raise Express JSON/text body limits for chat-sized plain-text payloads.
- [x] 1.2 Return JSON `413` diagnostics when requests exceed the configured body limit.

## 2. Current Session Context

- [x] 2.1 Remove per-message prompt trimming from compaction transcript formatting.
- [x] 2.2 Remove the latest-message character window from current-session recall context.
- [x] 2.3 Keep fallback compaction transcript text complete when summarization fails.

## 3. Attachments and Tool Output

- [x] 3.1 Inline full text attachment content instead of replacing large files with placeholders.
- [x] 3.2 Remove the shell output character cap.
- [x] 3.3 Replace bounded tool output normalization with full pass-through output.
- [x] 3.4 Send full tool output into subsequent model `ToolMessage` content.

## 4. Browser Runtime Output

- [x] 4.1 Remove browser script result character caps.
- [x] 4.2 Remove script cache value truncation.
- [x] 4.3 Return full replay response bodies.
- [x] 4.4 Remove obsolete replay body-limit request option handling.

## 5. Overflow Handling

- [x] 5.1 Estimate prompt size before the initial model call.
- [x] 5.2 Estimate prompt size after tool outputs are appended and before the next model call.
- [x] 5.3 Return `context_overflow` with concrete budget diagnostics instead of silently truncating.

## 6. Verification

- [x] 6.1 Run `npm run build:electron`.
- [x] 6.2 Run `npm run build:web`.
- [ ] 6.3 Add or update automated regression tests for large chat payloads, full tool output pass-through, and `context_overflow`.
