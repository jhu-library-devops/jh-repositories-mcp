---
title: Add a repository
sources:
  - src/adapters/index.ts
  - src/adapters/jscholarship/
  - src/adapters/jhrdr/
  - src/models/identifiers.ts
  - src/federation/
  - src/index.ts
  - src/config/env.ts
  - config/repositories/
verified: 2026-10-26
---

# Add a repository

A repository is an adapter behind the `RepositoryAdapter` seam plus a profile. Use the two existing adapters as the pattern: they share query-building and validation helpers but keep their own platform client and public check ([ADR-004](../adr/ADR-004-two-platform-specific-adapters.md)).

Before you write code, decide what "public" means on the new platform, and plan to enforce it twice: as immutable Solr filters in the profile, and as the canonical check in the platform client. See [Canonical gate](../architecture/canonical-gate.md).

## What to build

| Piece | Location | Notes |
| --- | --- | --- |
| Platform client | `src/adapters/<id>/` | Resolves one record through the canonical API as an anonymous caller. Returns `null` on 401, 403, 404, or when the record fails the platform's public check. Throws on backend faults. |
| Adapter | `src/adapters/<id>/index.ts` | Implements `RepositoryAdapter`. Builds Solr queries only through `src/adapters/solr-query.ts`, validates candidates with `canonicalizeInOrder`, and implements `probePublic` so cached records can be re-checked. |
| Profile | `config/repositories/<id>-profile.ts` | Field allowlists, immutable public filters, required and optional schema fields, full-text decision. Satisfies `RepositoryProfile`. |
| Endpoints | `config/repositories/<id>-endpoints.ts` | Private network locations per environment. Never publish these. |
| Repository ID | `RepositoryId` and the namespacing in `src/models/identifiers.ts` | Record IDs are `<id>:<platform-id>`, so platforms cannot collide. |
| Configuration | `src/config/env.ts` and `src/index.ts` | New URL variables, and wiring the adapter (wrapped in `withCaching`) into the tool context and startup schema validation. |
| Fixtures and tests | `test/fixtures/<id>/`, `test/contract/`, `test/integration/` | Include deliberately non-public records. See [Write tests and fixtures](./testing-and-fixtures.md). |

## Register it

The federation layer resolves adapters through the registry built at startup, so it needs no change for a new repository. What does need to know about the new ID:

| Where | Change |
| --- | --- |
| `src/index.ts` | Construct the adapter when its URLs are set and add it to the registrations the registry is built from. Give it a fusion weight only if the collections should not be weighted equally; the default is 1.0. |
| `src/models/schemas.ts` | Add the ID to the `repositories` selector enum and to `repositoryIdSchema`. The schema is static on purpose, so the input stays closed. |
| `src/mcp/tools/explain-search.ts`, `src/mcp/errors.ts` | Add the human-readable name the tool and the error messages use for it. |
| `src/observability/index.ts` | Add the ID to the known set, so telemetry labels it by name instead of `unknown`. |

The adapter must declare `contractVersion` and implement `probePublic`; both are required by the current adapter contract, and an adapter missing either does not compile. The registry refuses to start with more than 8 adapters or with a registered set whose full cursor would exceed 2048 bytes; both limits are far from the current two. See [Federation and pagination](../architecture/federation.md#the-adapter-registry).

## Checklist

- [ ] Public check enforced in both the profile filters and the platform client
- [ ] Non-public fixtures added, and `test/integration/non-public-disclosure.test.ts` covers the new repository
- [ ] Startup validation covers the new profile's required fields, and the adapter appears as eligible in the startup registry log line
- [ ] No Solr field names or platform URLs above `src/adapters/`
- [ ] `bun run docs:generate` run, and the new repository appears in [Repositories](../reference/repositories.md)
- [ ] Pages listed by the doc-impact comment rechecked
