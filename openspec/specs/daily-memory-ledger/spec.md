# daily-memory-ledger Specification

## Purpose
TBD - created by archiving change daily-memory-dream-embeddings-sqlite. Update Purpose after archive.
## Requirements
### Requirement: Canonical day key assignment
The system MUST assign a canonical `day_key` in `YYYYMMDD` format to every persisted recallable memory, based on the user's local application day at creation time.

#### Scenario: New memory receives day key
- **WHEN** a daily, dream, long-term, or script memory is stored on 2026-06-16
- **THEN** the stored row has `day_key = 20260616`

#### Scenario: Existing day key preserved on update
- **WHEN** a memory with `day_key = 20260616` is updated on a later date
- **THEN** the system keeps `day_key = 20260616` unless the caller explicitly specifies another date

### Requirement: List memories by day range
The system MUST support listing memories by `day_key`, memory kind, and update time using the SQLite `memories` table as the source of truth.

#### Scenario: List one day's memories
- **WHEN** the memory API is queried with `dayKey=20260616`
- **THEN** only memories with `day_key = 20260616` are returned, ordered by updated time descending

#### Scenario: List one kind across days
- **WHEN** the memory API is queried with `kind=script` and no `dayKey`
- **THEN** all script memories across all days are returned, ordered by updated time descending

### Requirement: Bootstrap new schema without legacy migration
The system MUST initialize SQLite with the new schema on startup. When an incompatible old database is detected, it MUST rebuild without migrating or preserving old memory data. Vector data is managed separately by Chroma; the old `memory_embeddings` table is no longer used.

#### Scenario: Legacy database exists
- **WHEN** `.nexo-data/memory.sqlite` has a schema version or table structure that does not match the current definition, including when `memory_embeddings` still exists
- **THEN** the system drops the old tables and creates a new empty database without importing old rows, and clears and rebuilds `.nexo-data/chroma/`

#### Scenario: First startup
- **WHEN** `memory.sqlite` does not exist or the database is empty
- **THEN** the system creates a `memories` table with `day_key` and `kind IN ('daily', 'dream', 'long_term', 'script')` plus required indexes, and initializes an empty Chroma collection

### Requirement: Day-grouped Markdown export
The system MUST write Markdown memory exports in day-grouped sections for human review of daily memory history.

#### Scenario: Export after storing daily memory
- **WHEN** a memory is stored for `20260616` and Markdown export is regenerated
- **THEN** the export contains a `20260616` section that includes that memory content

