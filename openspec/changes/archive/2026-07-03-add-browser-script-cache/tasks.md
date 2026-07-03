## 1. Script Cache Contract

- [x] 1.1 Add shared request fields for explicit script cache key and TTL.
- [x] 1.2 Add shared response fields for script cache write/delete/automatic-cache reports.
- [x] 1.3 Update `browser_action` schema to document `scriptCache` and automatic short-lived capture storage.

## 2. Runtime Cache

- [x] 2.1 Add a BrowserManager-owned in-memory script cache.
- [x] 2.2 Add TTL expiration and scheduled cleanup.
- [x] 2.3 Add maximum entry count and serialized value size protection.
- [x] 2.4 Clear script cache when the browser runtime is destroyed.

## 3. Script API

- [x] 3.1 Inject `scriptCache` into the `action="script"` execution context.
- [x] 3.2 Support `set`, `capture`, `get`, `getEntry`, and `list`.
- [x] 3.3 Support `delete`, `clear`, `consume`, and `consumeEntry` for active removal.
- [x] 3.4 Return cache write/delete summaries in `script.cache`.

## 4. Capture and Replay

- [x] 4.1 Automatically cache capture-like script return values.
- [x] 4.2 Support explicit `scriptCacheKey` and `scriptCacheTtlMs`.
- [x] 4.3 Add `scriptCache.replay` for cached request replay.
- [x] 4.4 Support replay cleanup through `deleteAfter` and `deleteOnSuccess`.

## 5. Orchestration Guidance

- [x] 5.1 Update Agent prompt so short-term capture samples use `scriptCache`, not `store_script_memory`.
- [x] 5.2 Add guidance that Agent should consume/delete temporary samples after one-time use.
- [x] 5.3 Keep `store_script_memory` reserved for stable reusable scripts, runbooks, and replay templates.

## 6. Verification

- [x] 6.1 Verify script cache set/get/delete.
- [x] 6.2 Verify TTL expiration.
- [x] 6.3 Verify automatic capture caching.
- [x] 6.4 Verify one-time consume removes the entry.
- [x] 6.5 Verify cached replay can delete the source entry after use.
