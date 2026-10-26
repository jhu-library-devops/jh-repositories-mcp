---
title: Federation and pagination
sources:
  - src/federation/
  - src/mcp/tools/search-items.ts
  - src/mcp/tools/list-facets.ts
  - src/mcp/tools/find-related-items.ts
  - src/adapters/canonicalize.ts
verified: 2026-10-21
---

# Federation and pagination

A search fans out to each selected repository, and the per-repository pages are merged into one list. Federation lives in `src/federation/index.ts`; the tool handlers in `src/mcp/tools/` call it.

## Fan-out and partial results

`search_items` queries every selected repository concurrently with `Promise.allSettled`.

- If some repositories fail, the result contains the others' records and a `backend_unavailable` warning naming each failed repository. `repositories.failed` lists them too.
- If every repository fails, the tool returns the `backend_unavailable` error.
- Warnings from all repositories are combined and capped at 10.

## Merging rankings

DSpace and Dataverse Solr scores are not comparable, so they are never read. Each repository's order is kept as its **Repository_Rank**, and the lists are merged with balanced reciprocal-rank fusion ([ADR-007](../adr/ADR-007-balanced-reciprocal-rank-merge.md)):

```text
fusionScore = weight / (60 + repositoryRank)      weight = 1 for every repository
```

Equal scores are broken deterministically:

1. The cursor's `nextTieSource` repository wins the first tie (JScholarship on the first page).
2. After each tie, the preference flips, so neither repository is favored across pages.
3. The namespaced record ID is the final tie-breaker.

## The cursor

Pagination state lives entirely in an opaque cursor, so any task can serve any page. There is no server-side session.

| Field | Meaning |
| --- | --- |
| `v` | Cursor format version |
| `queryHash` | FNV-1a 64-bit hash (16 hex characters) of the normalized query, repositories, field, filters, sort, and limit |
| `jsOffset`, `dvOffset` | The next unexamined Solr position in each repository, or `-1` when that repository is exhausted |
| `nextTieSource` | The repository that wins the next tie |

The cursor is canonical JSON, base64url-encoded. Decoding rejects strings over 2048 characters, invalid JSON, an unknown version, a malformed hash, offsets outside 0–1000 (other than `-1`), and an unknown tie source. A rejected cursor is an `invalid_input` error.

A well-formed cursor whose `queryHash` does not match the current request is not an error: pagination restarts at the first page with a `cursor_reset` warning ([ADR-012](../adr/ADR-012-cursor-mismatch-resets-instead-of-errors.md)).

Offsets advance by the number of candidates each repository *consumed*, including ones the [canonical gate](./canonical-gate.md) dropped, so a page never skips or repeats a candidate.

## Facets and related records

- `list_facets` asks each selected repository for counts on the requested facets. The `repository` facet is synthesized from each repository's match total. A facet a repository cannot provide is skipped with an `unsupported_filter` warning. `list_facets` also accepts an empty query.
- `find_related_items` resolves the source record, asks the target repositories for related candidates, merges them the same way as a search, and removes the source record. Because the source is removed after the merge trims to `limit`, a response can hold fewer than `limit` results.
