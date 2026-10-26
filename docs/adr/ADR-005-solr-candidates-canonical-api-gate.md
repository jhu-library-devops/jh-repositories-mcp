# ADR-005: Direct Private Solr for Candidates, Canonical API for Every Returned Record

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services, security
**Supersedes:** N/A

## Context and Problem Statement

We need fast, faceted search across both repositories while guaranteeing that only publicly accessible records reach MCP clients. Solr provides the speed and the search features, but it cannot be the access-control authority: the indexes lag the platforms and their copies of access flags drift. The canonical repository APIs (DSpace REST, the Dataverse Native API) are authoritative for public access but too slow to generate candidates.

## Decision Drivers

- Every returned record must pass the canonical API's public-access check
- Bounded, injection-proof use of Solr
- Low-latency search with facets and related-record signals
- The Solr indexes may contain records that are not publicly accessible

## Considered Options

1. **Private Solr for candidates, with a canonical API gate on every returned record.** Chosen.
2. **Canonical API only, with no direct Solr access.** Rejected: neither platform's public API offers the facets, "more like this", or relevance tuning that the search experience needs, and both are far slower than Solr for candidate generation.
3. **Solr only, relying on immutable filters.** Rejected: the filters narrow candidates to *plausibly* public records, but a withdrawn item stays in the index until the next re-index, and nothing short of asking the platform can tell the difference.

## Decision Outcome

Solr supplies candidates, facets, and related-record signals. Every candidate is confirmed through the canonical API, called anonymously, before it is returned, and all returned metadata comes from that canonical response.

### Positive Consequences

- Fast candidate generation with Solr's full feature set.
- An authoritative gate prevents disclosure of withdrawn, draft, or restricted content.
- Defense in depth: the immutable filters reduce candidate volume, and the canonical check decides.
- An inconsistent index cannot produce unauthorized disclosure.

### Negative Consequences

- Every returned record costs one more API call, bounded by the worker pool and the over-fetch ceiling.
- Latency is higher than a Solr-only design.
- The canonicalization fan-out has to be bounded to avoid cascading load on the platforms.
- A damaged index or an API outage reduces result counts rather than failing the search.

## Links

- [Canonical gate](../architecture/canonical-gate.md)
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
