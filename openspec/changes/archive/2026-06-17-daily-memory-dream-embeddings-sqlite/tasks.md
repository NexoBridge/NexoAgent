## 1. Schema and Types

- [x] 1.1 Define memory types in Electron, shared API types, and UI: `daily`, `dream`, `long_term`, `script`
- [x] 1.2 Add day key utilities for generating, validating, and normalizing `YYYYMMDD`
- [x] 1.3 Implement new SQLite `memories` schema with `day_key` and four memory kinds; rebuild on version mismatch without migrating old data
- [x] 1.4 Create SQLite indexes for `kind`, `day_key`, `(kind, day_key)`, `key`, `scope`, and `updated_at`
- [x] 1.5 Remove `memory_embeddings`, `memory.json` read/write, and legacy schema migration logic
- [x] 1.6 Add `chromadb` dependency and implement Chroma client wrapper for collection `nexo_memories` at `.nexo-data/chroma`

## 2. Day-Based Memory Storage

- [x] 2.1 Implement `storeMemory` with explicit `dayKey` support and day preservation on updates
- [x] 2.2 Store daily memory entries from conversation extraction
- [x] 2.3 Implement memory listing helper with `kind`, `dayKey`, and reverse updated-time ordering
- [x] 2.4 Implement Markdown export grouped by day with daily and dream sections
- [x] 2.5 Implement delete and clear operations for all four memory kinds and sync Chroma vector deletion

## 3. Dream Memory System

- [x] 3.1 Implement `consolidateDreamForDay(dayKey, options)` to summarize a day into `dream:<dayKey>`
- [x] 3.2 Store source memory ids, themes, and generation metadata in dream memory metadata
- [x] 3.3 Gracefully handle missing credentials or model failures during dream generation
- [x] 3.4 Enqueue debounced dream consolidation after daily memory extraction
- [x] 3.5 Add a manual path to regenerate dream records by day

## 4. Semantic Retrieval (Chroma)

- [x] 4.1 Implement Chroma upsert with `memory_id`, `content`, and metadata (`kind`, `day_key`)
- [x] 4.2 Implement Chroma delete by `memory_id`; wipe collection when clearing all memory
- [x] 4.3 Implement recall through Chroma similarity query plus metadata filters for `kinds`, `dayKey`, and `k`
- [x] 4.4 Fall back to SQLite keyword and recency ranking when Chroma or embedding is unavailable
- [x] 4.5 Include relevant dream records and their `day_key` in default recall output
- [x] 4.6 Implement Chroma retry/backfill for pending memories when credentials become available

## 5. API and UI Integration

- [x] 5.1 Implement `GET /api/memory` with `dayKey` and all four memory kinds
- [x] 5.2 Implement semantic memory search with `query`, `kinds`, `dayKey`, and `k`
- [x] 5.3 Implement endpoint to regenerate dream records by day
- [x] 5.4 Update `recall_memory` tool to use new recall filters and include dream context
- [x] 5.5 Update Memory UI to show daily and dream memories with day filtering and deletion

## 6. Verification

- [x] 6.1 Verify old `memory.sqlite` / `memory_embeddings` rebuilds on startup and old data is not retained
- [x] 6.2 Verify storing a new memory on 2026-06-16 creates `day_key = 20260616` and Chroma has the corresponding vector
- [x] 6.3 Verify deleting memory removes both the SQLite row and Chroma vector
- [x] 6.4 Verify dream regeneration updates `dream:<dayKey>` instead of creating duplicates, including Chroma upsert
- [x] 6.5 Verify Chroma semantic recall works with embeddings and falls back cleanly without API credentials
- [x] 6.6 Run `npm run typecheck` and fix TypeScript errors
