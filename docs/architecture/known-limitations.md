---
title: Known limitations
sources:
  - src/adapters/caching.ts
  - src/config/env.ts
  - src/index.ts
  - src/adapters/jscholarship/index.ts
  - src/mcp/tools/find-related-items.ts
  - src/federation/
  - src/mcp/tools/list-facets.ts
  - src/mcp/tools/search-items.ts
  - config/repositories/jhrdr-profile.ts
  - config/repositories/jhrdr-endpoints.ts
  - infra/modules/mcp-service/
verified: 2026-10-26
---

# Known limitations

This page lists behavior you would otherwise discover by surprise: places where the service does less than its design intends, or where a reasonable assumption is wrong. Each entry describes what the code does today and what it means for you. The code is the authority; if an entry no longer matches it, the entry is wrong and should be removed.

## Cached search pages are not revalidated

A repository search page that passed the [canonical gate](./canonical-gate.md) is cached for `CACHE_SEARCH_TTL_MS` and served as is on a hit. The design intends every cached candidate to be revalidated before it is returned ([ADR-011](../adr/ADR-011-search-cache-never-bypasses-canonical-gate.md)); the current cache does not do that. A record withdrawn after its page was cached can therefore appear in search results until the entry expires. Single-record lookups are unaffected: a cached record is re-probed through the canonical API before it is served. Keep the search TTL at or below the Solr re-index lag.

## Both backend clients use the Solr timeout

`TIMEOUT_API_MS` is parsed and validated but never read. The DSpace and Dataverse clients both use `TIMEOUT_SOLR_MS`. Setting `TIMEOUT_API_MS` has no effect.

## JHRDR URLs are not validated at startup

`JHRDR_SOLR_URL` and `JHRDR_API_URL` are accepted as strings, not as URLs. A malformed non-empty value passes configuration validation and then stops the process while the JHRDR adapter is constructed, so the failure appears after the "configuration valid" point rather than in the startup report with everything else.

## Disabled features are reported, not enforced

When an optional Solr field is missing, schema validation reports the feature that depends on it under `disabledFeatures` in `/health/ready`. Nothing reads that list. The JScholarship adapter still issues MoreLikeThis queries for `find_related_items` when the `*_mlt` fields are absent, so the request fails at the backend instead of being skipped. Treat `disabledFeatures` as a warning to act on, not as a switch that has already been thrown.

## The `access` filter is never applied

`filters.access` is part of the `search_items` input schema, and every request that sets it gets an `unsupported_filter` warning for each repository. No adapter maps it to a Solr field.

## Related-record pages can be short

`find_related_items` merges candidates from the target repositories, trims the merged list to `limit`, and then removes the source record. When the source was in the trimmed list, the page holds `limit - 1` results. A short page does not mean the repositories had nothing more.

## Routing health does not include schema validation

The ECS container health check and the load balancer target group both probe `GET /health/live`, which answers 200 whenever the process is running. `GET /health/ready`, which reports Solr schema validation, is not consulted for routing. A task whose schema validation failed still receives traffic; its backend-dependent tools return `backend_unavailable`. Check `/health/ready` after every deployment, as the smoke test does.

## JHRDR's Solr-side anonymous filter is off

The JHRDR profile's Solr clause for anonymous discoverability is commented out pending verification against the deployed index, so the Dataverse public check (a `RELEASED` version state, retrieved anonymously) carries the whole gate for JHRDR. The gate still holds, because the canonical check is the layer that decides. The Solr filter would only narrow candidates earlier. `config/repositories/jhrdr-endpoints.ts` is likewise a declared placeholder.

## Facet merging is not wired to `list_facets`

`src/federation/facet-merge.ts` merges facet values across repositories: labels that normalize to the same form are combined, counts are summed with a per-repository breakdown, and each facet is capped at ten values. `list_facets` does not call it. The tool still returns each repository's facet values separately, as it did before the federation layer was generalized.

## Federation limits and fusion weights are fixed in code

The federation layer accepts a per-request `rrfK`, canonicalization budget, and deadline, and the registry accepts a fusion weight per adapter, but nothing reads them from the environment. `search_items` uses the defaults: `k = 60`, a budget of 150 candidates, a 10 s deadline, every weight 1.0, and at most 8 registered adapters. Changing any of them is a code change in `src/index.ts` or the handler, not a configuration change.

## Two deadlines apply to one request

The edge middleware enforces `TIMEOUT_DEADLINE_MS` (default 10 s, at most 30 s) on the whole HTTP request, and the federation pipeline enforces its own 10 s deadline on the adapter dispatch. Raising `TIMEOUT_DEADLINE_MS` above 10 s does not give a search more time; the federation deadline fires first and returns a partial result with a `deadline_exceeded` warning.
