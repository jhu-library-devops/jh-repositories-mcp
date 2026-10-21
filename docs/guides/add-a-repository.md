---
title: Adding a repository
sources:
  - src/adapters/index.ts
  - src/adapters/jscholarship/
  - src/adapters/jhrdr/
  - src/models/identifiers.ts
  - src/federation/
  - src/index.ts
  - src/config/env.ts
  - config/repositories/
verified: 2026-10-21
---

# Adding a repository

A repository is an adapter behind the `RepositoryAdapter` seam plus a profile. Use the two existing adapters as the pattern: they share query-building and validation helpers but keep their own platform client and public check ([ADR-004](../adr/ADR-004-two-platform-specific-adapters.md)).

## What to build

| Piece | Location | Notes |
| --- | --- | --- |
| Platform client | `src/adapters/<id>/` | Resolves one record through the canonical API as an anonymous caller. Returns `null` on 401, 403, 404, or when the record fails the platform's public check. Throws on backend faults. |
| Adapter | `src/adapters/<id>/index.ts` | Implements `RepositoryAdapter`. Builds Solr queries only through `src/adapters/solr-query.ts`, validates candidates with `canonicalizeInOrder`, and implements `probePublic` so cached records can be re-checked. |
| Profile | `config/repositories/<id>-profile.ts` | Field allowlists, immutable public filters, required and optional schema fields, full-text decision. Satisfies `RepositoryProfile`. |
| Endpoints | `config/repositories/<id>-endpoints.ts` | Private network locations per environment. Never publish these. |
| Repository ID | `RepositoryId` and the namespacing in `src/models/identifiers.ts` | Record IDs are `<id>:<platform-id>`, so platforms cannot collide. |
| Configuration | `src/config/env.ts` and `src/index.ts` | New URL variables, and wiring the adapter (wrapped in `withCaching`) into the tool context and startup schema validation. |
| Fixtures and tests | `test/fixtures/<id>/`, `test/contract/`, `test/integration/` | Include deliberately non-public records. See [Testing and fixtures](./testing-and-fixtures.md). |

Decide what "public" means on the new platform before writing code, and enforce it twice: as immutable Solr filters in the profile, and as the canonical check in the platform client. See [Canonical gate](../architecture/canonical-gate.md).

## Federation limits today

The federation layer is written for two repositories:

- The cursor stores one offset per repository in named fields (`jsOffset`, `dvOffset`).
- The tie-break alternates between exactly two sources.
- Several schemas bound repository lists at two entries.

A third repository therefore needs a new cursor version and a generalized merge, not only a new adapter. Treat that as a structural change and record it in an ADR. See [Federation and pagination](../architecture/federation.md).

## Checklist

- [ ] Public check enforced in both the profile filters and the platform client
- [ ] Non-public fixtures added, and `test/integration/non-public-disclosure.test.ts` covers the new repository
- [ ] Startup validation covers the new profile's required fields
- [ ] No Solr field names or platform URLs above `src/adapters/`
- [ ] `bun run docs:generate` run, and the new repository appears in [Repositories](../reference/repositories.md)
- [ ] Pages listed by the doc-impact comment rechecked
