# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-21

### Added

- Implement federated ranking and pagination: balanced reciprocal-rank merge with deterministic alternating tie handling, versioned base64url cursor codec with FNV-1a query-hash binding and stale-cursor reset semantics, exhaustion sentinels, sanitized Partial_Result assembly, and property tests for Properties 10-13 and 16
- Complete repository access and schema spike with JScholarship/JHRDR Solr field verification, private route testing, and sanitized fixture payloads
- Add bounded resilience: single-retry exponential backoff with full jitter on all three backend clients, bounded TTL LRU caches for search and canonical records with revalidate-on-emit probes that evict withdrawn records and fail closed on probe faults, per-task tool-concurrency semaphore returning rate_limited without queuing, and canonicalization worker-pool wiring from config
- Implement the JHRDR adapter: allowlisted candidate search with publication-date filtering, bounded rank-ordered canonicalization via the Dataverse client with shared cursor arithmetic, allowlisted facets with unsupported-concept warnings, metadata-derived related discovery, JHRDR schema validation wired into startup, and a shared canonicalization helper refactored out of both adapters
- Implement normalized domain models (RepositoryRecord, ItemDetail, Creator, SearchRequest/Response, Facet, Warning) with closed JSON Schemas and property tests
- search_items, list_facets, and find_related_items log a backend_fault line (failing call, HTTP status, partial_results or backend_unavailable) for each repository that fails; the smoke test now checks find_related_items and query-less list_facets; a missing year field is reported in readiness as year_facet; an unconfigured repository's error names what the server does offer
- Implement the search_items and get_item tool handlers: federated adapter orchestration with cursor lifecycle (invalid rejected pre-I/O, stale reset with warning, exhausted-repository skip), partial and total backend-failure handling, identifier classification and routing, indistinguishable not-found, and a canonicalization fix so search summaries conform to the strict output schema
- Implement the Dataverse canonical Native API client: anonymous latest-published dataset resolution with pre-I/O persistent-identifier validation, the RELEASED-only Public_Record gate with indistinguishable not-found behavior, minimal-GET cache revalidation probe, citation-block normalization with restricted files excluded and summaries capped, plus synthetic JHRDR fixtures and contract tests
- Implement explain_search (concept-level interpretation with no backend syntax), the two jhu-repo resource templates resolving through canonical get_item, and the explore_research_topic and find_reusable_data prompts with a fixed instruction preamble and fenced argument data, plus Property 15 tests
- Implement the safe Solr query layer: Lucene/Solr value encoder, RepositoryProfile-parameterized search/facet/MoreLikeThis builders with a non-client-accessible immutable-public-filter step, bounded request parameters (fl, rows, start, timeAllowed), and a fixed-URL Solr client restricted to /select and /mlt with redirects disabled
- Log a backend_fault line (tool, repository, failing call, HTTP status) whenever get_item or find_related_items returns backend_unavailable, so the cause is visible to operators without reaching clients
- Add the multi-stage production container: version-and-digest-pinned oven/bun stages for install, type-check, test, and Bun-targeted bundle; non-root runtime with OCI labels, dependency-free health check, TMPDIR-only writability for read-only root filesystems, and a .dockerignore keeping specs, env files, and infra out of the build context
- Implement the JScholarship adapter: allowlisted candidate search, rank-ordered bounded canonicalization with nextOffset = startOffset + candidatesConsumed cursor arithmetic and validation_attrition warnings, allowlisted facets with per-repository counts, MoreLikeThis related discovery, and paired Solr/DSpace integration tests
- Implement the stateless MCP HTTP server: low-level registry advertising the five read-only tools with closed JSON Schemas and strict unknown-property rejection, structuredContent plus compact text plus resource links, the two jhu-repo resource templates and both prompts, edge middleware (Host/Origin allowlists, request-size bound, correlation IDs, overall deadline), version endpoint, SIGTERM draining, and full adapter wiring in the composition root
- Return server instructions in the MCP initialize result, so every connected assistant — not only those invoking a guided prompt — is told what these two repositories do and do not cover, that omitted candidates make result counts lower bounds, that a not_found never distinguishes a missing record from a restricted one, and that record metadata is untrusted depositor text. The instructions also permit pointing researchers to other openly accessible JHU collections (Catalyst, ArchivesSpace, Digital Collections, the Levy Sheet Music Collection, and the Chesney Medical Archives catalog) as clearly-marked suggestions — referral only, handing over a URL rather than searching those systems on the researcher's behalf, and never with invented identifiers, holdings claims, or constructed links.
- Implement RepositoryProfile interface with versioned JScholarship field manifest and read-only Solr Schema API startup validation
- Add privacy-preserving observability: a deny-by-default tool-invocation serializer that constructs every emitted key explicitly, bounded free-text logging that never emits metadata objects, CloudWatch EMF metric lines dimensioned by tool, and registry wiring with correlation IDs and client info; Property 14 tests prove hostile fields and research content cannot reach logs
- Establish cross-repository MCP application with strict TypeScript, Bun, Hono, MCP SDK, stateless Streamable HTTP transport, and environment configuration validation
- Implement the list_facets and find_related_items tool handlers: cross-repository facet merging with normalized-label grouping and most-frequent display form, count-then-label ordering capped at 10 values, synthesized repository facet, canonical-first related-source resolution with native in-repo and metadata-derived cross-repo discovery, source exclusion, and partial-failure warnings
- Implement the DSpace canonical REST client: anonymous UUID/Handle resolution with pre-I/O identifier validation, the Public_Record gate with indistinguishable not-found behavior, HEAD-based cache revalidation probe, canonical metadata normalization with bounded ORIGINAL bitstream summaries, and fixture-driven contract tests
- get_item and item resources now return the record's full public canonical metadata as a bounded, name-ordered metadata array (DSpace metadata map; every Dataverse metadata block flattened to leaf fields), in structuredContent and the text block; dc.description.provenance and datasetContactEmail are withheld

### Changed

- get_item no longer fails when DSpace cannot list an item's files: it returns the metadata with an empty file list and filesStatus "unavailable" (never cached), logs a backend_fault with effect files_omitted, and the smoke test warns on it
- When an item's file list can't be loaded, get_item's text now shows the metadata with a plain-language note (open the item page or try again shortly) instead of status wording, and the server instructions tell the host model to explain problems without internal codes
- get_item lists metadata in the platform's familiar display order (DSpace simple item view; Dataverse citation block) with record-keeping dates last, and the Details text no longer repeats the title, creators, date, citation, or link shown above it
- get_item shows metadata under readable labels (Author, Date issued, Sponsor, Funding agency) in a Details section instead of platform field names such as dc.contributor.author; structuredContent keeps the field name and adds the label
- Pin Bun 1.3.11 (was 1.2.15) in .bun-version, the digest-pinned oven/bun base image, package.json engines, and @types/bun

### Fixed

- JScholarship facet labels no longer show DSpace's index encoding ("portraits ||| portraits"), and creator, subject, and type filters now match by querying the plain *_keyword fields
- Fix get_item by JScholarship Handle always failing with backend_unavailable: DSpace answers pid/find with a 302, which the client refused; the redirect is now read and mapped to the item on the private API base
- Fix ALLOWED_ORIGINS validation to allow the empty-allowlist safe default, restoring the config test suite
- The container image now installs dependencies with `bun install --frozen-lockfile`; the previous `bun ci` step does not exist in the pinned Bun 1.2.15 and failed the build.
- find_related_items no longer depends on a Solr /mlt handler: JScholarship related records use the MoreLikeThis component on /select (mlt=true), as DSpace does, and /mlt is removed from the Solr path allowlist
- Date-range filters now run over each repository's typed date field (JScholarship dc.date.issued_dt, JHRDR dateSort) with whole-period bounds, so dateTo=2023 includes all of 2023; impossible dates such as 2023-02-30 are rejected as invalid input
- Fix JScholarship citation URLs: the 1774.2 handle prefix is not registered in the global Handle.net registry, so persistent IDs now cite the repository landing page instead of a dead hdl.handle.net link
- Smoke test now sends the Accept header the MCP transport requires, and exercises search_items plus get_item by ID and by Handle against the deployed backend
- list_facets without a query (or with filters only) now aggregates every public record instead of returning no values, and the repository facet counts matching records instead of 0

### Security

- The container image now applies Debian security updates to its runtime layer at build time, fixing two critical GnuTLS vulnerabilities (CVE-2026-33845, CVE-2026-42010) inherited from the pinned Bun base image.
