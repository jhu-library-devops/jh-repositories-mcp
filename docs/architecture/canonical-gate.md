---
title: Canonical gate
sources:
  - src/adapters/canonicalize.ts
  - src/adapters/caching.ts
  - src/adapters/solr-query.ts
  - src/adapters/jscholarship/
  - src/adapters/jhrdr/
  - src/mcp/tools/get-item.ts
  - src/mcp/errors.ts
  - config/repositories/
verified: 2026-10-26
---

# Canonical gate

> Solr finds candidates. The canonical API decides truth.

The Solr indexes are private, they lag the platforms, and their copies of access-control fields can drift from what the platforms enforce. If the service trusted the index, a thesis withdrawn this morning would still be returned this afternoon, and a dataset whose files were restricted last week would still list them. So Solr is only used to find **candidates**. A candidate becomes a returned record only after the repository's **canonical API** (DSpace REST or the Dataverse Native API), called anonymously, confirms it is public. [ADR-005](../adr/ADR-005-solr-candidates-canonical-api-gate.md) records the decision.

## Four layers

No single layer is trusted alone, because each one covers a way the others can fail. A change that looks safe in one can defeat another.

| Layer | Where | What it guarantees | What it covers for |
| --- | --- | --- | --- |
| Immutable public filters | `immutablePublicFilters` in `config/repositories/*-profile.ts`, appended by every builder in `src/adapters/solr-query.ts` | Every Solr request is narrowed to plausibly public records. No input can remove, weaken, or negate the filters. | Keeps the volume of non-public candidates low, so the canonical check is cheap and attrition is rare. |
| Field allowlists | The profile's query, filter, facet, sort, and related-field maps | Client input reaches Solr only through approved fields. There is no raw Solr passthrough; unmapped concepts become warnings. | A crafted query cannot reach a field the filters don't cover, or rewrite the filters themselves. |
| Canonical validation | `canonicalizeInOrder` in `src/adapters/canonicalize.ts`, plus each platform client | Only records the canonical API confirms as public are returned. All returned metadata comes from the canonical response, never from Solr. | A stale or wrong index flag cannot disclose a record. |
| Indistinguishable not-found | `notFound()` in `src/mcp/errors.ts`, used by `get_item` and resource reads | A nonexistent identifier and a non-public one get the same response. | A client cannot learn that a restricted record exists by probing identifiers. |

The rules for each repository's filters are listed in [Repositories](../reference/repositories.md#public-access-rules).

## Validating candidates

`canonicalizeInOrder` resolves candidates through the canonical API **in rank order**, with at most `MAX_CANONICALIZATION_WORKERS` look-ups running ahead of the consumer, and stops as soon as the page is full.

- A candidate the platform client resolves to `null` is dropped. Clients return `null` on HTTP 401, 403, or 404, and when the record fails the platform's public check.
- An individual backend fault is also an omission: the record is left out rather than filled from Solr.
- Omissions are reported as a `validation_attrition` warning, so result counts are lower bounds.
- Because consumption stops at a rank-order prefix, the number of candidates consumed is exact. The cursor depends on that: the next page starts at `offset + consumed`. See [Federation and pagination](./federation.md).

The platform checks are:

| Repository | Client | Public when |
| --- | --- | --- |
| JScholarship | `src/adapters/jscholarship/dspace-client.ts` | Anonymously retrievable, `inArchive`, `discoverable`, and not `withdrawn` |
| JHRDR | `src/adapters/jhrdr/dataverse-client.ts` | Anonymously retrievable, and the version state is `RELEASED` |

## Caching

`withCaching` (`src/adapters/caching.ts`) wraps each adapter with two bounded LRU caches. They hold public normalized data only.

| Cache | Key | On a hit | TTL setting |
| --- | --- | --- | --- |
| Search pages | The full repository search request | Served as is. Entries are pages that already passed validation. | `CACHE_SEARCH_TTL_MS` |
| Single records | Repository and identifier | Re-probed through the canonical API (`probePublic`) before it is served. A record that is no longer public is evicted and reported not found. A probe fault propagates, so the cache fails closed. | `CACHE_RECORD_TTL_MS` |

Facets, related-record queries, and schema validation are not cached. A record whose file list could not be loaded (`filesStatus: "unavailable"`) is returned but not cached.

Because search-page hits are not revalidated, a record withdrawn after it was cached can appear in search results until its entry expires. Keep `CACHE_SEARCH_TTL_MS` at or below the Solr re-index lag. This is a gap between the design and the code: [ADR-011](../adr/ADR-011-search-cache-never-bypasses-canonical-gate.md) records the intended contract, and [Known limitations](./known-limitations.md#cached-search-pages-are-not-revalidated) describes the current behavior.

## Errors never explain

Client-visible errors are fixed strings. An error that said "this record is withdrawn" would confirm the record exists, which is exactly what the fourth layer prevents. Unexpected faults become `backend_unavailable` with no detail; the cause goes only to the server log. The full list is in [Errors and warnings](../reference/errors.md).

## Change a public-access rule

Change the profile's immutable filters **and** the platform client's public check together. Add a fixture for the newly excluded case and extend `test/integration/non-public-disclosure.test.ts`. See [Write tests and fixtures](../guides/testing-and-fixtures.md).
