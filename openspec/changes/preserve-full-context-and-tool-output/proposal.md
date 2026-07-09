## Why

Recent runtime work changed Nexo Agent's context handling from "silently bound or trim large payloads" to "preserve complete user-visible context and fail explicitly when the active model cannot accept it." The previous OpenSpec state still described bounded tool output, raw references, and trimmed auxiliary context as the expected behavior. That no longer matches the implementation or the user's accuracy requirement.

The repair is needed so OpenSpec reflects the current product contract: chat messages, current-session recall text, text attachments, shell output, tool output, and browser script/replay output must not be silently clipped by the application. When the full payload exceeds the active model's input budget, the system must report a context overflow with concrete budget diagnostics instead of pretending the missing content was inspected.

## What Changes

- Increase the HTTP request body limit for chat/channel text payloads and return a JSON `413` error when the configured limit is exceeded.
- Preserve full current-session transcript text for recall/query construction instead of selecting only a recent character window.
- Preserve complete text attachments in prompt context instead of replacing large files with "too large to inline" placeholders.
- Preserve full shell, built-in tool, browser script, script cache inspect fallback, and replay response output in tool results.
- Remove application-level inline/preview/raw-reference truncation from the default tool-output normalization path.
- Add explicit `context_overflow` handling before initial model calls and before later model calls after full tool outputs have been appended.
- Update browser script guidance so scripts may still return concise summaries by choice, but the runtime no longer silently replaces full output with bounded summaries.

## Capabilities

### Modified Capabilities

- `token-aware-context-management`: replaces silent trimming/bounded output behavior with full-context preservation and explicit overflow diagnostics.
- `browser-script-runtime`: removes script/replay output truncation and preserves full script cache values where serialization permits.
- `model-orchestration`: requires the orchestrator to treat complete tool outputs as present unless a `context_overflow` stop reason says the model request could not be sent.

## Impact

- `electron/server/index.ts`: request body size limit and JSON overflow response.
- `electron/server/conversation-context.ts`: full transcript formatting for compaction and recall query construction.
- `electron/server/attachments.ts`: full text attachment inlining.
- `electron/server/tools/shell-command.ts`: full shell stdout/stderr normalization.
- `electron/server/tool-output.ts`: pass-through tool output normalization.
- `electron/server/browser-manager.ts`: full script result, script cache, and replay response handling.
- `electron/server/agent.ts`: full auxiliary sections, full `ToolMessage` content, and explicit context overflow stops.
- `electron/server/types.ts`: `context_overflow` stop reason.

## Non-Goals

- Do not guarantee that every possible payload can fit into every model context window.
- Do not remove automatic conversation compaction; compaction remains a separate summarization mechanism.
- Do not change UI-only previews, titles, log tailing, or knowledge-base excerpt ranking unless they affect the main chat/model context contract.
- Do not remove `scriptCache`; scripts may still use it to manage temporary browser samples intentionally.
