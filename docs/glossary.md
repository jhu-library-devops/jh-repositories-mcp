---
title: Glossary
sources:
  - src/models/index.ts
  - src/adapters/index.ts
  - src/federation/index.ts
verified: 2026-10-26
---

# Glossary

These are the terms the code, the specifications, and this site use. Use them exactly, and avoid the alternatives listed under each one; most of the alternatives blur a distinction the design depends on.

## Records

**Candidate**
A Solr search result that has not yet passed Canonical API validation. Candidates are never returned to a client.
*Avoid:* hit, raw result, Solr result.

**SearchResult**
A normalized, citation-ready record returned in search and related-record lists. A projection of canonical data without expanded file summaries.
*Avoid:* record summary, search hit, result item.

**ItemDetail**
The full normalized record returned by a single-item lookup, including bounded public file summaries. The complete projection of canonical data.
*Avoid:* canonical record, full record, detailed record.

**Public Record**
A record confirmed retrievable by an anonymous caller through its repository's Canonical API. The conditions differ by platform (for DSpace: archived, discoverable, latest version, not withdrawn, anonymously readable; for Dataverse: a released, non-deaccessioned version that needs no API key), but the meaning is the same: confirmed safe for public disclosure. Each adapter implements its own check; there is no shared `isPublic()`.
*Avoid:* visible record, accessible item.

**Persistent Identifier**
A JScholarship Handle or a JHRDR DOI or Handle. The durable, citation-ready identifier for a record.
*Avoid:* PID, permanent link, permalink.

## Backends

**Canonical API**
DSpace REST for JScholarship, or the Dataverse Native API for JHRDR. The authoritative source of record metadata and public-access status.
*Avoid:* backend API, repository API.

**Field Allowlist**
A repository-specific mapping from MCP search concepts to approved Solr fields. No query, filter, facet, or sort may reference a field outside it.
*Avoid:* field map, schema map, whitelist.

**Immutable Public Filter**
Solr filter clauses appended to every search, facet, and related-record query. No client input can remove, weaken, or negate them; they change only through code, when a platform's access model changes.
*Avoid:* security filter, access filter, hardcoded filter.

## Federation

**Federation**
The merged search experience across both repositories: one query, two sources, one ranked list. It describes what the client sees. The service queries each Solr index directly and validates through the Canonical APIs; it does not delegate to the platforms' own search endpoints.
*Avoid:* metasearch, cross-search.

**Repository Rank**
A result's ordinal position within one repository's native result list. Raw Solr scores are never exposed or compared across repositories.
*Avoid:* score, relevance score, confidence.

**Federated Rank**
The position produced when repository-local lists are merged by balanced reciprocal-rank fusion. Not a probability or a confidence value.
*Avoid:* global rank, combined score.

**Cursor**
An opaque, versioned token carrying per-repository pagination offsets and a hash of the query that produced it. All paging state lives in the token; the server keeps none.
*Avoid:* page token, session state, continuation token.

**Partial Result**
A successful response that contains results from one repository and a warning that another was unavailable.
*Avoid:* degraded response, fallback result.

## How the terms relate

- A **Candidate** becomes a **SearchResult** only after passing validation through its **Canonical API**.
- A **SearchResult** and an **ItemDetail** are projections of the same canonical data. They differ in depth, not in source.
- A **Cursor** is bound to the normalized query that produced it. A mismatched cursor resets pagination; it is not an error.
- A **Partial Result** holds **SearchResult** records from one repository and a warning about the other.
- **Repository Rank** is the input to the merge that produces **Federated Rank**.
- The **Field Allowlist** is the only path from an MCP concept to a Solr field.

Two words that used to be ambiguous: "record" once meant both the unvalidated Candidate and the validated SearchResult, and "canonical record" meant both the full item view and the act of resolving it. Now a Candidate is pre-validation, a SearchResult is post-validation, the full view is an ItemDetail, and the act of resolving is *canonicalization*.
