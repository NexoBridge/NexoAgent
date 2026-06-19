## ADDED Requirements

### Requirement: Dream record generation
The system MUST generate or update one dream record for a day by summarizing and associating that day's stored memories.

#### Scenario: Consolidate a day with memories
- **WHEN** dream consolidation runs for `day_key = 20260616` and that day already has stored memories
- **THEN** the system upserts one memory with `kind = dream` and key `dream:20260616`, including summary text, source memory ids, and generation metadata

#### Scenario: Consolidate a day without memories
- **WHEN** dream consolidation runs for a day with no source memories
- **THEN** the system does not create an empty dream record

### Requirement: Dream records assist recall
The system MUST include relevant dream records in memory recall so dream summaries can help later assistant replies.

#### Scenario: Dream matches query
- **WHEN** a user query matches a dream record semantically or by keyword
- **THEN** recall returns that dream record with memory kind `dream`

#### Scenario: Dream links back to date
- **WHEN** recall returns a dream record
- **THEN** the returned context includes the dream's `day_key`

### Requirement: Dream consolidation does not block main flow
The system MUST keep conversation and memory storage available when dream generation fails or model credentials are unavailable.

#### Scenario: Model call fails during dream generation
- **WHEN** the model provider returns an error during dream generation
- **THEN** the system does not write partial dream content and the original daily memories remain stored

#### Scenario: Missing API key
- **WHEN** dream consolidation is requested without available API credentials
- **THEN** the system skips generation gracefully and returns an explicit failure status to the caller

### Requirement: Dream lifecycle management
The system MUST allow listing, regenerating, and deleting dream records through memory management paths.

#### Scenario: Delete dream record
- **WHEN** a dream memory is deleted
- **THEN** the SQLite row and the corresponding Chroma vector for that `memory_id` are removed

#### Scenario: Regenerate dream record
- **WHEN** dream generation runs again for the same `day_key`
- **THEN** the system updates the existing `dream:<day_key>` record in SQLite and Chroma instead of creating a duplicate dream record
