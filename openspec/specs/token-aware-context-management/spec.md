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
The system SHALL budget memories, knowledge, attachments, and tool outputs against the same model input allowance used for conversation history.

#### Scenario: Auxiliary context would exceed budget
- **WHEN** injected memories, attachments, knowledge, or tool outputs would push the prompt over budget
- **THEN** the runtime SHALL trim or compact lower-priority auxiliary context before sending the request

#### Scenario: Tool output is large
- **WHEN** a tool result is larger than the allowed retained prompt budget
- **THEN** the runtime SHALL keep a bounded representation of that tool output in prompt context

### Requirement: Out-of-band storage for oversized tool outputs
The system SHALL keep oversized tool outputs out of the default model context while preserving a retrievable raw reference.

#### Scenario: Tool output exceeds inline budget
- **WHEN** a tool result exceeds the configured inline character or token budget
- **THEN** the runtime SHALL store the complete raw output out-of-band when it is within the raw-output storage limit
- **AND** the model context SHALL receive only a compact summary, short preview, raw reference, and size/truncation metadata

#### Scenario: Tool output exceeds raw storage budget
- **WHEN** a tool result exceeds the configured raw-output storage budget
- **THEN** the runtime SHALL store a bounded head/tail sample and statistics instead of the complete payload
- **AND** the model context SHALL state that the raw output itself was too large to retain fully

#### Scenario: Compacting a conversation with raw output references
- **WHEN** conversation compaction summarizes earlier tool calls that used raw output references
- **THEN** the compaction summary SHALL preserve the reference, summary, and important diagnostics
- **AND** it SHALL NOT inline the complete raw output into the rolling session summary

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
