# token-aware-context-management Specification

## Purpose
TBD - created by archiving change codex-style-context-management. Update Purpose after archive.
## Requirements
### Requirement: Model-aware context budgeting
The system SHALL assemble prompts against a model-aware context budget instead of relying only on message-count trimming.

#### Scenario: Resolve context budget from local dictionary
- **WHEN** the active model matches a known entry in the maintained local context-window dictionary
- **THEN** the runtime SHALL use that dictionary value as the model context budget unless the user has explicitly overridden it

#### Scenario: Profile provides explicit context budget
- **WHEN** the active model profile defines `contextWindowTokens` and `reservedOutputTokens`
- **THEN** the runtime SHALL use those values to calculate the maximum input budget for prompt assembly

#### Scenario: Profile omits explicit context budget
- **WHEN** the active model profile does not define an explicit context window
- **THEN** the runtime SHALL fall back to inferred or configured defaults and continue building the prompt

#### Scenario: Unknown model requires first-use lookup
- **WHEN** the active model cannot be resolved from explicit profile fields, the local dictionary, or provider metadata
- **THEN** the runtime SHALL perform a one-time lookup flow, persist the discovered context budget, and reuse that stored value on later calls

### Requirement: Heuristic token estimation before model calls
The system SHALL estimate token usage before each model call using the configured approximation rules until provider-reported usage is available.

#### Scenario: Estimate mixed-language user content
- **WHEN** the runtime estimates prompt cost for Chinese and English content before a request
- **THEN** it SHALL apply the configured heuristic rates and produce a single estimated token budget value for prompt assembly

#### Scenario: Provider returns usage
- **WHEN** the provider response includes `usage`
- **THEN** the runtime SHALL record the actual prompt and completion token counts for subsequent budgeting and diagnostics in the same run

### Requirement: Persisted context-budget lookup cache
The system SHALL persist resolved model context-window metadata so repeated calls do not need to rediscover the same model budget.

#### Scenario: Reuse cached lookup
- **WHEN** a model's context window was previously resolved and stored locally
- **THEN** the runtime SHALL reuse the stored value before attempting another lookup

#### Scenario: User corrects stored context budget
- **WHEN** a user edits the stored or profile-level context budget for a model
- **THEN** the runtime SHALL prefer the user-provided value over the cached lookup result

### Requirement: Automatic compaction near the context limit
The system SHALL automatically compact thread history when the estimated prompt budget approaches the configured auto-compaction threshold.

#### Scenario: Prompt exceeds compact threshold
- **WHEN** estimated input usage reaches or exceeds the configured auto-compaction limit for the active model
- **THEN** the runtime SHALL summarize older thread context and rebuild the prompt before sending the next model request

#### Scenario: Long task requires repeated compaction
- **WHEN** a session continues to grow after one compact pass
- **THEN** the runtime SHALL allow additional compaction passes to keep the conversation within the active model budget

### Requirement: Rolling session summary for thread-local continuity
The system SHALL maintain a rolling summary for the current thread and keep only a recent window of raw turns in the live prompt.

#### Scenario: Build compacted prompt
- **WHEN** the runtime compacts a long-running thread
- **THEN** it SHALL preserve a rolling session summary plus the configured recent raw turns instead of keeping the entire transcript verbatim

#### Scenario: Resume a compacted thread
- **WHEN** a user resumes a thread that already has a rolling session summary
- **THEN** the runtime SHALL include that summary as thread-local context for continued work

#### Scenario: Avoid re-summarizing the same messages
- **WHEN** a thread has a rolling session summary from an earlier compaction pass
- **THEN** the runtime SHALL track how many non-system conversation messages are already covered by that summary
- **AND** later compaction passes SHALL summarize only newly uncovered older messages before the recent raw window

### Requirement: Tool-grounded compaction summaries
The system SHALL preserve the difference between tool-backed facts and unverified assistant narration when compacting conversation history.

#### Scenario: Assistant claim has no tool result
- **WHEN** earlier conversation text claims that a browser action, shell command, file edit, network request, or verification occurred without a corresponding retained tool result
- **THEN** the compaction summary SHALL NOT record that claim as completed work
- **AND** the summary SHALL mark it as planned, requested, assumed, or unverified as appropriate

#### Scenario: Tool result exists
- **WHEN** earlier conversation contains a tool call result, command output, browser state, or error
- **THEN** the compaction summary SHALL preserve the relevant result, error, attempted action, and remaining task state needed for the next model call

### Requirement: Shared budget across auxiliary context
The system SHALL preserve complete current-session messages, text attachments, and tool outputs in the assembled runtime context until the active model input budget is exceeded. It SHALL NOT silently trim lower-priority auxiliary context as a substitute for reporting overflow.

#### Scenario: Auxiliary context fits the active model budget
- **WHEN** current-session transcript text, recalled memory, knowledge notes, text attachments, and tool outputs fit within the active model input budget
- **THEN** the runtime SHALL include those sections without application-level character truncation

#### Scenario: Auxiliary context would exceed budget
- **WHEN** the complete assembled prompt would exceed the active model input budget
- **THEN** the runtime SHALL stop before sending the model request
- **AND** it SHALL return `stopReason="context_overflow"` with estimated prompt tokens and budget details
- **AND** it SHALL NOT silently drop recent messages, attachment text, or tool output content to make the request fit

#### Scenario: Automatic compaction is enabled
- **WHEN** automatic conversation compaction summarizes earlier turns
- **THEN** the compaction summary SHALL be treated as a summary mechanism, not as silent truncation of the latest raw context
- **AND** if the compacted prompt still exceeds the active model input budget, the runtime SHALL return `context_overflow`

### Requirement: Out-of-band storage for oversized tool outputs
The system SHALL pass tool outputs through the normal chat/model path without application-level truncation. Out-of-band storage MAY still be used by specific tools or user-facing artifacts, but the default tool-output normalization path SHALL NOT replace oversized output with a summary, preview, or raw reference.

#### Scenario: Tool output is large but fits the model budget
- **WHEN** a tool result is large and the resulting prompt remains within the active model input budget
- **THEN** the runtime SHALL send the complete tool result to the UI event stream and to subsequent model context
- **AND** `outputStats.truncated` SHALL be `false`

#### Scenario: Tool output makes the next model call too large
- **WHEN** a complete tool result would make the next model call exceed the active model input budget
- **THEN** the runtime SHALL preserve the complete tool result in the tool trace
- **AND** the run SHALL stop with `stopReason="context_overflow"` before sending another model request
- **AND** the runtime SHALL NOT synthesize a partial preview and continue as though the complete output were available to the model

### Requirement: Lazy raw tool output retrieval
The system SHALL allow raw tool output to be retrieved by reference without sending it through the default chat message stream.

#### Scenario: User expands raw output in the UI
- **WHEN** the user opens the raw output section for a bounded tool result
- **THEN** the frontend SHALL fetch the raw output by reference on demand
- **AND** the chat history payload SHALL remain bounded before that explicit fetch

#### Scenario: Model needs full raw output
- **WHEN** the assistant needs the complete raw output for a later step
- **THEN** it SHALL explicitly request or invoke a supported retrieval path for the raw reference
- **AND** it SHALL not assume the complete raw output is already present in prompt context

### Requirement: HTTP text payload intake
The system SHALL accept chat-sized plain text payloads up to a configurable request-body limit and report request-body overflow as structured JSON.

#### Scenario: Large plain-text chat payload is within the configured body limit
- **WHEN** a user sends a large plain-text message whose request body is within `NEXO_REQUEST_BODY_LIMIT`
- **THEN** the server SHALL accept and store the complete message content

#### Scenario: Request body exceeds the configured limit
- **WHEN** a chat or text API request body exceeds the configured Express body limit
- **THEN** the server SHALL return HTTP `413`
- **AND** the response body SHALL be JSON that includes the active request body limit

### Requirement: Current-session recall query fidelity
The system SHALL build current-session recall/search query text from the full available current-session transcript instead of selecting only a latest character window.

#### Scenario: Current session contains long user messages
- **WHEN** the runtime prepares current-session context for memory or knowledge recall
- **THEN** it SHALL include the full formatted conversation transcript available in the session
- **AND** individual message bodies SHALL NOT be shortened by a fixed character cap

#### Scenario: Large current-session transcript exceeds model context
- **WHEN** the complete current-session transcript contributes to a prompt that exceeds the active model budget
- **THEN** the model request path SHALL fail with `context_overflow` instead of silently selecting only recent content
