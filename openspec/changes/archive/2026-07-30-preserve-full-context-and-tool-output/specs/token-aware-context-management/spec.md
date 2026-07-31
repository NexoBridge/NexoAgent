## MODIFIED Requirements

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

## ADDED Requirements

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
