## MODIFIED Requirements

### Requirement: Orchestrate from bounded tool output summaries
The orchestrator SHALL treat tool outputs as complete when the runtime successfully appends them to model context. It SHALL only assume missing output when the runtime explicitly reports `context_overflow` or a tool itself returns a deliberate summary/cache key.

#### Scenario: Tool result is passed through completely
- **WHEN** a tool result is present in the model context and no `context_overflow` has occurred
- **THEN** the orchestrator SHALL reason from that complete tool result
- **AND** it SHALL NOT claim that a hidden raw reference must be fetched solely because the result is large

#### Scenario: Tool intentionally returns a summary or cache key
- **WHEN** a tool or script deliberately returns a summary, artifact reference, or script cache key instead of raw data
- **THEN** the orchestrator SHALL respect that tool-authored contract
- **AND** it SHALL fetch or inspect the referenced data only when the task requires the full payload

#### Scenario: Runtime reports context overflow
- **WHEN** the runtime stops with `stopReason="context_overflow"`
- **THEN** the orchestrator SHALL NOT claim it inspected omitted content
- **AND** the user-facing response SHALL state that the complete context exceeded the active model input budget

## ADDED Requirements

### Requirement: Preserve user-provided long-form text as authoritative context
The orchestrator SHALL treat long-form text supplied in the current session as authoritative when it is accepted by the server and included in the prompt.

#### Scenario: User sends a large plain-text document
- **WHEN** the server accepts and stores a large plain-text user message
- **THEN** the orchestrator SHALL treat that complete message as current-session context
- **AND** it SHALL NOT assume the application retained only a recent excerpt

#### Scenario: Long-form text cannot fit the model
- **WHEN** the accepted long-form text cannot fit into the active model input budget with the rest of the prompt
- **THEN** the runtime SHALL return `context_overflow`
- **AND** the orchestrator response SHALL ask for explicit compression, deletion, or a larger-context model rather than silently proceeding with a partial excerpt
