# ADR-005: Direct Private Solr for Candidates, Canonical API for Every Returned Record

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services, security
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

We need fast, faceted search across both repositories while guaranteeing that only publicly accessible records reach MCP clients. Solr provides speed and search features but cannot be the sole access-control authority. The canonical repository APIs (DSpace REST, Dataverse Native API) are authoritative for public access but too slow for candidate generation.

## Decision Drivers

- Requirement 9: Every returned record must pass canonical API public-access validation
- Requirement 10: Bounded, injection-proof Solr use
- Requirement 2.4-2.6, 3.4-3.7: Candidates validated through canonical API before return
- Low-latency search with facets and related-record signals
- Solr indexes may contain records that are not publicly accessible

## Considered Options

1. Direct private Solr for candidates, canonical API gate for every returned record
2. Canonical API only (no direct Solr access)
3. Solr only with immutable filters (no canonical API validation)

## Decision Outcome

**Chosen option:** Option 1 — Direct private Solr for candidates, canonical API for every returned record, because Solr supplies fast search, facets, and related signals while the repository API remains the public-access authority.

### Positive Consequences

- Fast candidate generation with full Solr capabilities (facets, MLT, relevance)
- Authoritative public-access gate prevents disclosure of withdrawn/draft/restricted content
- Defense in depth: immutable Solr filters reduce candidate volume, canonical API provides final verification
- Solr index inconsistencies cannot produce unauthorized disclosure

### Negative Consequences

- Every returned record requires an additional API call (bounded by worker pool and over-fetch ceiling)
- Higher latency than Solr-only approach
- Canonicalization fan-out must be bounded to prevent cascading load
- A damaged index or API outage can reduce result counts (mitigated by over-fetch ceiling)

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table, Request Flows
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 2.4-2.6, 3.4-3.7, 9, 10
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 5, 6, 7.2, 8, 9.2
- Branch: tofu-iac-starter
