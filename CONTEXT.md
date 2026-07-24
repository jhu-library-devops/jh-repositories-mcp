# JHU Repository MCP

A federated discovery service exposing public Johns Hopkins repository content through the Model Context Protocol.

## Language

**SearchResult**:
A normalized, citation-ready record returned in search and related-record lists. A projection of canonical data without expanded file summaries.
_Avoid_: Record_Summary, search hit, result item

**ItemDetail**:
The full normalized record returned by a single-item lookup, including bounded public file summaries. The complete projection of canonical data.
_Avoid_: Canonical_Record, full record, detailed record

**Candidate**:
A Solr search result that has not yet passed Canonical_API validation. Candidates are not returned to the client.
_Avoid_: hit, raw result, Solr result

**Public_Record**:
A record that is published, not draft, not revoked, and not embargoed — confirmed retrievable by an anonymous user through its repository's Canonical_API. The specific conditions differ between DSpace (non-withdrawn, discoverable, latest-version, archived, anonymous-readable) and Dataverse (published, not deaccessioned, latest published version, no API key required), but the meaning is the same: confirmed safe for public disclosure. Each adapter implements its own platform-specific check; there is no shared `isPublic()` across adapters.
_Avoid_: visible record, accessible item

**Canonical_API**:
DSpace REST for JScholarship or the Dataverse Native API for JHRDR. The authoritative source of record metadata and public-access status.
_Avoid_: backend API, repository API (too vague)

**Field_Allowlist**:
A repository-specific mapping from MCP search concepts to approved Solr fields. No query, filter, or facet may reference a field outside this allowlist.
_Avoid_: field map, schema map, whitelist

**Immutable_Public_Filter**:
A set of Solr filter clauses appended to every search, facet, and related-record query. Non-overridable by the client at runtime — no MCP input can remove, weaken, or negate them. Updated by the service owner through code changes when platform access models evolve.
_Avoid_: security filter, access filter (too vague), hardcoded filter (implies never changes)

**Persistent_Identifier**:
A JScholarship Handle or a JHRDR DOI/Handle. The durable, citation-ready identifier for a record.
_Avoid_: PID, permanent link, permalink

**Cursor**:
An opaque, versioned token carrying per-repository pagination offsets and a query hash. Stateless — all paging state is encoded in the token itself.
_Avoid_: page token, session state, continuation token

**Partial_Result**:
A successful response containing results from one repository and an explicit warning that another repository was unavailable.
_Avoid_: degraded response, fallback result

**Repository_Rank**:
A result's ordinal position within one repository's native result list. Raw Solr scores are never exposed or compared across repositories.
_Avoid_: score, relevance score, confidence

**Federated_Rank**:
The position produced when repository-local result lists are merged using balanced reciprocal-rank fusion. Not a probability or confidence value.
_Avoid_: global rank, combined score

**Federation**:
The merged search experience across both repositories. Refers to the user-visible behavior (one query, two sources, combined results), not to delegating queries through each platform's native search interface. The MCP queries Solr directly and validates through Canonical APIs — it does not use DSpace or Dataverse search endpoints.
_Avoid_: metasearch, cross-search (library-specific connotations)

## Relationships

- A **Candidate** becomes a **SearchResult** only after passing validation through its **Canonical_API**
- A **SearchResult** and an **ItemDetail** are projections of the same canonical data — they differ in depth (file expansion), not source
- A **Cursor** is bound to the normalized query that produced it; a mismatched cursor triggers a reset, not an error
- A **Partial_Result** contains **SearchResult** records from one repository and a warning about the other
- **Repository_Rank** is the input to the balanced reciprocal-rank merge that produces **Federated_Rank**
- **Field_Allowlist** is the only path from MCP concepts to Solr fields — no query bypasses it

## Example dialogue

> **Dev:** "When a search returns results, are those validated through the Canonical_API?"
> **Domain expert:** "Yes — every Candidate must pass the public-access gate. The search cache stores Candidates, but they're always re-validated before becoming SearchResults."

> **Dev:** "What's the difference between a SearchResult and an ItemDetail?"
> **Domain expert:** "Same canonical data, different projection depth. SearchResult omits the file list. ItemDetail includes it. Both come from the same Canonical_API call — ItemDetail just keeps more of the response."

> **Dev:** "If the cursor's query hash doesn't match, do we error?"
> **Domain expert:** "No — we reset to page 1 and include a cursor_reset warning. The model learns pagination restarted without entering a retry loop."

## Flagged ambiguities

- "record" was used to mean both the Solr Candidate and the validated SearchResult — resolved: Candidate is pre-validation, SearchResult is post-validation.
- "canonical record" was used both as a domain concept (the full item view) and as a description of the API resolution process — resolved: the domain concept is **ItemDetail**; "canonical resolution" or "canonicalization" describes the validation process.
