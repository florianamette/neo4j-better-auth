---
"neo4j-better-auth": minor
---

Clean-code and security pass over the adapter.

- Cascade deletes now follow every `references.onDelete: "cascade"` declared in the Better Auth schema (depth first, cycle safe) instead of being hard-coded to the `user` model.
- Unknown `where` operators throw instead of silently falling back to equality; `in` / `not_in` accept a scalar; Better Auth's `mode: "insensitive"` is honored for string comparisons.
- The implicit `id` field is always accepted in `where` and `sortBy` (Better Auth 1.7 no longer lists it among schema fields).
- Node creation uses a single `SET n = $props` map parameter; redundant double serialization and the no-op pre-delete edge cleanup were removed (`DETACH DELETE` already drops edges).
- Driver `bigint` integers are normalized like `Integer` values.
- Internals split into focused modules (`cypher-runner`, `schema-context`, `rows`, `relations`) with shared query builders.
- Security: `better-auth` peer range raised to `^1.6.2` (versions below carry published advisories); dev dependencies upgraded to patched releases; the example app no longer falls back to a hard-coded auth secret.
- Repository renamed to `neo4j-better-auth` to match the npm package; `package.json` URLs updated.
