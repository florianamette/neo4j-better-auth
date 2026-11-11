---
"neo4j-better-auth": patch
---

Fix password reset and other verification-token flows crashing with `deleteMany failed` / `Cannot read properties of undefined (reading 'counters')` (#2).

- `deleteMany` / `delete` now count deleted nodes from the query's returned record instead of `result.summary.counters`, which isn't available in every runtime or driver setup.
- Add a native, race-safe `consumeOne`, so Better Auth no longer falls back to `findOne` + `deleteMany` for single-use tokens. Concurrent consumers of the same token now get exactly one winner.
