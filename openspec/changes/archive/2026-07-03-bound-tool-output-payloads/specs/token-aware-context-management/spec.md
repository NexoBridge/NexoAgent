## ADDED Requirements

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
