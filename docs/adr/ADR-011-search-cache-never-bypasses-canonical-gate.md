# ADR-011: Search Cache Never Bypasses the Canonical API Gate

**Date:** 2024-07-24
**Status:** Accepted. The current implementation differs; see [Known limitations](../architecture/known-limitations.md#cached-search-pages-are-not-revalidated).
**Deciders:** Platform engineering, library research services, security
**Supersedes:** N/A

## Context and Problem Statement

Repeated identical searches are common when an assistant iterates on a question, and each one costs a canonical API call per returned record. A cache would absorb that load. The question was what the cache may hold and whether a hit may skip the gate.

## Decision Drivers

- No tolerance for serving a recently withdrawn or restricted record from a search cache
- Bounded load on the canonical APIs
- Different risk for a single-item lookup, where the caller named the record, and a search page, which a caller may act on without verifying

## Considered Options

1. **Cache validated results and serve hits without revalidation.** Rejected as the contract: a record withdrawn during the TTL would keep appearing in search results, and a search page is exactly what a researcher acts on without checking each entry.
2. **Cache Solr candidates only, and revalidate every hit through the canonical API before return.** Chosen.
3. **No caching.** Rejected: the simplest option, but every repeated search would re-hit both canonical APIs for every record on the page.

## Decision Outcome

The search cache holds candidates, not validated results, and every hit passes through the canonical gate before it is returned. A separate single-record cache may hold a validated `ItemDetail` for the same TTL, because the staleness window there applies to one record the caller named, not to a search page.

### Positive Consequences

- Zero disclosure window for cached search results.
- Repeated searches still save the Solr round trip.

### Negative Consequences

- Canonical API load is not reduced for repeated searches.
- A cache hit is not much faster than a miss.

## Links

- [Canonical gate](../architecture/canonical-gate.md), caching
- [Known limitations](../architecture/known-limitations.md#cached-search-pages-are-not-revalidated)
