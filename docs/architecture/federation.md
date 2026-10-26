---
title: Federation and pagination
sources:
  - src/federation/
  - src/adapters/registry.ts
  - src/mcp/tools/search-items.ts
  - src/mcp/tools/list-facets.ts
  - src/mcp/tools/find-related-items.ts
  - src/mcp/tools/explain-search.ts
  - src/adapters/canonicalize.ts
verified: 2026-10-26
---

# Federation and pagination

A search fans out to each selected repository, and the per-repository pages are merged into one ranked list. The federation layer lives in `src/federation/`, with `federatedSearch` in `service.ts` as the pipeline the `search_items` handler calls. Nothing in this layer names a repository: every adapter is resolved through the **adapter registry**, and the layer sees ranked lists of namespaced records. That is what lets a third repository be added without changing the merge ([ADR-013](../adr/ADR-013-n-repository-federation-through-an-adapter-registry.md)).

## The adapter registry

At startup, `src/index.ts` registers each constructed adapter and builds an immutable registry (`buildRegistry` in `src/adapters/registry.ts`) before readiness can report healthy. Building it runs each adapter's schema validation to decide **dispatch eligibility**: an adapter whose required Solr fields are missing is registered but never dispatched to. Each registration carries a fusion weight, 1.0 when none is given.

A registry that cannot be built stops the process rather than serving requests with a bad configuration: a duplicate repository ID, no adapter at all, every adapter failing schema validation, a weight outside 0.01–100, more adapters than the limit (8), or a registered set so large that a full cursor would exceed 2048 bytes. The failing condition is written to `/health/ready` as a `code` before the exit, so a probe that races it sees the reason. The adapter contract itself is versioned (`contractVersion`), so an adapter built for an older contract fails to compile instead of failing at runtime.

## Selecting repositories

The `repositories` argument is `"all"`, one repository ID, or an array of IDs; omitting it means `"all"`. `"all"` resolves to every eligible adapter. An array is deduplicated and sorted. An ID that is not registered rejects the request as `invalid_input` before any backend is called, and the message names the repositories this deployment does serve. `find_related_items` takes the same shapes in `targetRepositories`, and `explain_search` lists every registered repository under `availableRepositories`, so a client can discover the set without guessing.

## The search pipeline

`federatedSearch` runs these steps in order:

1. **Resolve the selector** against the registry.
2. **Decode and reconcile the cursor.** A malformed cursor is `invalid_input`; a well-formed one is reconciled against the current query and participating set (see below).
3. **Allocate fetch windows.** Each repository may be asked for up to `3 × limit` candidates so the merge has headroom after the [canonical gate](./canonical-gate.md) drops some. When the windows would sum past the canonicalization budget (150 candidates per request), each is reduced in proportion to its weight so they sum to exactly the budget. Without the budget, a wide selection at a large `limit` would turn one tool call into hundreds of canonical API calls.
4. **Dispatch concurrently under the overall deadline** (10 s). If the deadline passes with some results in hand, the response is partial with a `deadline_exceeded` warning; with none, it is the `backend_unavailable` error.
5. **Merge** the pages by rank (below).
6. **Assemble the response**: `repositories.requested`, `succeeded`, and `failed` (each sorted), one warning per failed repository, and the next cursor. Warnings are capped at 10.

If some repositories fail, the result holds the others' records and a `backend_unavailable` warning naming each failure. If every selected repository fails, the tool returns the `backend_unavailable` error. A failed repository's offset is left out of the next cursor, so the next page retries it from where it last stood, or from zero.

## Merging rankings

DSpace and Dataverse Solr scores are not comparable: the two indexes have different schemas, boosts, and document counts, so a score of 4.2 from one says nothing against a 4.2 from the other. The scores are never read. Each repository's order is kept as its **Repository Rank**, and the lists are merged with weighted reciprocal-rank fusion ([ADR-007](../adr/ADR-007-balanced-reciprocal-rank-merge.md)):

```text
fusionScore = weight / (k + repositoryRank)      k = 60, weight = 1.0 unless configured
```

At each step the merge takes the head with the highest fusion score across all non-empty queues, until `limit` is reached or every queue is empty. Every emitted record carries its `repository` and its source rank, so the attribution survives the merge. The merged position is never presented as a probability or a cross-repository relevance score.

Equal scores are broken by a **tie sequence**: a round-robin ring over the participating repositories in lexicographic order, with a position that the cursor carries. On a tie, the repository at the current position wins and the position advances, so neither repository is favored across pages. When the position points at a repository that is not among the tied ones, the nearest one forward in the ring wins. The namespaced record ID is the final tie-breaker.

When only one repository is selected, or only one returned results, its native order is kept with no re-ranking.

## The cursor

Pagination state lives entirely in an opaque cursor, so any task can serve any page. There is no server-side session, which is what lets the service run as several identical Fargate tasks behind one load balancer.

| Field | Meaning |
| --- | --- |
| `v` | Cursor format version, currently `2` |
| `queryHash` | FNV-1a 64-bit hash (16 hex characters) of the normalized query, repositories, field, filters, sort, and limit |
| `offsets` | One `[repository, offset]` pair per repository that contributed to the page, sorted by ID. The offset is the next unexamined Solr position, bounded at 1,000,000. |
| `participating` | The sorted set of repositories the page was drawn from |
| `nextTieSequence` | The tie ring's position for the next page |

The cursor is canonical JSON, base64url-encoded, at most 2048 bytes. Decoding rejects an unknown version, invalid JSON, a malformed hash, an out-of-range offset, and any ID that is not registered; a rejected cursor is an `invalid_input` error, raised before any backend call. Version 1 cursors, which carried fixed `jsOffset` and `dvOffset` fields, still decode and are mapped onto the version 2 shape, so a client holding one keeps paginating.

A well-formed cursor is then reconciled against the current request ([ADR-012](../adr/ADR-012-cursor-mismatch-resets-instead-of-errors.md)):

| Situation | Outcome | Warning |
| --- | --- | --- |
| The `queryHash` does not match the request | Every offset resets to the first page, the tie position to zero | `cursor_reset` |
| The cursor names a repository that is no longer participating | Pagination resets to the first page, because the carried positions describe a different set | `cursor_reset` |
| A participating repository has no offset in the cursor (newly selected or newly registered) | That repository starts at zero; the others keep their offsets | `cursor_expanded` |

A cursor from a different query is never an error, because an assistant that refines its query between calls would otherwise fall into a retry loop.

Offsets advance by the number of candidates each repository *consumed*, including ones the canonical gate dropped, so a page never skips or repeats a candidate.

## Facets and related records

- `list_facets` asks each selected repository for counts on the requested facets and returns them per repository. The `repository` facet is synthesized from each repository's match total. A facet a repository cannot provide is skipped with an `unsupported_filter` warning. `list_facets` also accepts an empty query. The federation layer contains an N-way facet merge (`facet-merge.ts`) that combines values across repositories; it is not yet wired to the tool. See [Known limitations](./known-limitations.md#facet-merging-is-not-wired-to-list_facets).
- `find_related_items` resolves the source record, asks the target repositories for related candidates, merges them with the same fusion (single page, no cursor), and removes the source record. Because the source is removed after the merge trims to `limit`, a response can hold fewer than `limit` results; see [Known limitations](./known-limitations.md#related-record-pages-can-be-short).
