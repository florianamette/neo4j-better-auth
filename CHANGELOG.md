# neo4j-better-auth

## 0.2.0

### Minor Changes

- 63a78fb: Clean-code and security pass over the adapter.
  
  - Cascade deletes now follow every `references.onDelete: "cascade"` declared in the Better Auth schema (depth first, cycle safe) instead of being hard-coded to the `user` model.
  - Unknown `where` operators throw instead of silently falling back to equality; `in` / `not_in` accept a scalar; Better Auth's `mode: "insensitive"` is honored for string comparisons.
  - The implicit `id` field is always accepted in `where` and `sortBy` (Better Auth 1.7 no longer lists it among schema fields).
  - Node creation uses a single `SET n = $props` map parameter; redundant double serialization and the no-op pre-delete edge cleanup were removed (`DETACH DELETE` already drops edges).
  - Driver `bigint` integers are normalized like `Integer` values.
  - Internals split into focused modules (`cypher-runner`, `schema-context`, `rows`, `relations`) with shared query builders.
  - Security: `better-auth` peer range raised to `^1.6.2` (versions below carry published advisories); dev dependencies upgraded to patched releases; the example app no longer falls back to a hard-coded auth secret.
  - Repository renamed to `neo4j-better-auth` to match the npm package; `package.json` URLs updated.

## 0.1.1

### Patch Changes

- 12eca7b: Harden the Neo4j adapter by improving transaction atomicity for multi-step writes, validating `where` and `sortBy` fields against schema-derived DB fields, and normalizing operational error handling.

  Also improves release workflow robustness by aligning CI/runtime settings and dependency-audit coverage.
