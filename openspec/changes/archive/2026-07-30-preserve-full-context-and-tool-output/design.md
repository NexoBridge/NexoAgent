## Context

The implementation now treats accuracy and transparency as higher priority than silently keeping prompts small. Earlier code paths used fixed character limits for shell output, tool output previews, browser script results, current-session recall transcripts, and attachment inlining. Some of those limits were useful for stability, but they made it possible for the UI or model to behave as if content had been inspected when the application had already clipped it.

This change repairs the OpenSpec gap after the code was updated directly.

## Goals / Non-Goals

Goals:

- Preserve complete main chat history text wherever the application constructs current-session context.
- Preserve complete tool outputs through SSE display, persisted tool call metadata, and model `ToolMessage` content.
- Preserve complete text attachments in model context.
- Make request-body overflow and model-context overflow explicit.
- Keep diagnostics concrete enough to explain whether the blocker was HTTP body size or model input budget.

Non-goals:

- Fit arbitrary multi-megabyte content into models with smaller context windows.
- Rewrite the knowledge-base retrieval strategy or skill instruction budgeting in this repair.
- Remove intentional user/model-authored summaries or automatic context compaction.

## Decisions

### Full Payloads Are the Default

`normalizeToolOutputForModel` now returns the original output for `modelOutput`, `displayOutput`, and `outputPreview`, with `outputStats.truncated=false`. Shell output and browser script/replay output also stop applying fixed character caps.

### Context Overflow Is Explicit

The agent estimates runtime prompt tokens before the first model call and before each later loop iteration. If the complete prompt exceeds `maxInputTokens`, the run returns `status="failed"` and `stopReason="context_overflow"` with estimated prompt tokens, model input budget, context window, reserved output, and tool-schema reserve.

### Current-Session Recall Uses the Full Transcript

`formatCurrentSessionContextForRecall` and `buildCompactionTranscript` no longer select a latest `28k`-style character window or trim individual message bodies. This makes recall/query construction faithful to the current session text.

### HTTP Body Limits Are Configurable and Observable

The Express JSON/text body limit is raised to `20mb` by default and can be overridden with `NEXO_REQUEST_BODY_LIMIT`. Oversized requests return JSON `413` responses instead of an HTML parser error page.

### Browser Scripts Still May Choose Compact Outputs

The runtime no longer enforces script result truncation. However, tool guidance can still encourage scripts to return summaries or cache keys when the agent knows complete logs would exceed the model window. That is an intentional script behavior, not hidden application clipping.

## Risks / Trade-offs

- Very large conversations, attachments, or tool outputs can now fail earlier with `context_overflow` instead of being automatically reduced.
- Full payloads may increase memory, disk, SSE, and model request size.
- Existing specs that describe bounded tool output are now superseded by this change and should be reconciled when the change is archived.

## Migration Plan

- Keep saved sessions compatible; existing `ToolOutputStats` and raw-output reference fields remain optional/shared types.
- Do not delete archived changes that recorded the old behavior; this repair change documents the newer contract.
- Archive this change into the stable specs after review, especially `token-aware-context-management`.

## Open Questions

- Whether knowledge-base excerpts should also stop excerpting matched documents, or whether retrieval snippets should remain an intentional ranked excerpt feature.
- Whether the default `20mb` request-body limit should be exposed in Settings instead of only via `NEXO_REQUEST_BODY_LIMIT`.
