# ADR-011: Search Cache Never Bypasses the Canonical API Gate

The search candidate cache absorbs repeated identical queries (60-second TTL) but cached candidates are always re-validated through the Canonical API before return. The cache stores Solr candidate data, not validated SearchResults. There is zero tolerance for serving a recently-withdrawn or restricted record from cache.

A separate `get_item` canonical cache (60-second TTL) is acceptable because it caches the full validated ItemDetail for direct lookups only — the maximum staleness window for a withdrawal is 60 seconds on a specific-item request, not on search results that a user may act on without verifying.

## Considered Options

1. Cache validated SearchResults and skip re-validation on cache hit (lower API load, risk of serving withdrawn items for up to TTL)
2. Cache Solr candidates only; always re-validate before return (higher API load, zero disclosure window for search)
3. No caching at all (simplest, highest backend load)

Option 2 was chosen because the service owner has zero tolerance for serving withdrawn content in search results. The 60-second `get_item` cache is a pragmatic exception — a user requesting a specific item by ID accepts a brief freshness window, and the operational risk is bounded to one record at a time rather than search pages.
