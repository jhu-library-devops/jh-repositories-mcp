# Requirements Document

## Introduction

The JScholarship/JHRDR MCP is a read-only Model Context Protocol service that enables AI research assistants to discover and cite public Johns Hopkins repository content across two independently managed systems:

- JScholarship, an institutional repository built on DSpace with a SolrCloud Discovery index.
- The Johns Hopkins Research Data Repository (JHRDR), a research data repository built on Dataverse with a Solr index.

The service presents one normalized MCP interface while preserving platform-specific retrieval, access-control, metadata, and identifier semantics. It runs on ECS Fargate in the VPC and private subnets shared by the two repository deployments. Solr generates candidates, facets, and related-record signals; the DSpace and Dataverse APIs provide canonical metadata and the final public-access gate.

The first release is intentionally retrieval-only. It contains no embedded language model, vector database, repository write operation, or file-content proxy.

## Glossary

- **MCP_Server**: The stateless JScholarship/JHRDR MCP service running on ECS Fargate.
- **MCP_Client**: An AI assistant or application using MCP Streamable HTTP.
- **Repository**: Either <code>jscholarship</code> or <code>jhrdr</code>.
- **JScholarship_Adapter**: The component that queries the DSpace Solr <code>search</code> collection and resolves records through DSpace REST.
- **JHRDR_Adapter**: The component that queries the Dataverse Solr <code>collection1</code> collection and resolves records through the Dataverse Native API.
- **Canonical_API**: DSpace REST for JScholarship or the Dataverse Native API for JHRDR.
- **Record_Summary**: A normalized, citation-ready search result built from a Canonical_API response after public-access validation, without an expanded file list.
- **Canonical_Record**: A full normalized record returned by an item lookup, including bounded public file or bitstream summaries.
- **Candidate**: A Solr search result that has not yet passed Canonical_API validation.
- **Public_Record**: A published, discoverable record that an anonymous user may retrieve through its repository's Canonical_API.
- **Persistent_Identifier**: A JScholarship Handle or a JHRDR DOI/Handle.
- **Field_Allowlist**: A repository-specific mapping from MCP concepts to approved Solr fields.
- **Repository_Rank**: A result's rank within one repository's native result list.
- **Federated_Rank**: The position produced when repository-local result lists are merged without comparing raw Solr scores.
- **Cursor**: An opaque, versioned token carrying the per-repository position for a federated search.
- **Partial_Result**: A successful response containing results from one repository and an explicit warning that another repository was unavailable.

## Requirements

### Requirement 1: Federated Search

**User Story:** As a public researcher using an AI assistant, I want to search both Johns Hopkins repositories through one tool, so that I can discover publications and reusable datasets together.

#### Acceptance Criteria

1. WHEN an MCP_Client invokes <code>search_items</code> with a query containing 1 to 512 characters, THE MCP_Server SHALL search the selected Repository values and return a normalized result page.
2. WHEN the Repository selector is <code>all</code> or is omitted, THE MCP_Server SHALL search JScholarship and JHRDR concurrently.
3. WHEN the Repository selector is <code>jscholarship</code> or <code>jhrdr</code>, THE MCP_Server SHALL call only the corresponding adapter.
4. WHEN an MCP_Client supplies approved filters for field, date range, resource type, creator, subject, collection, access, sort, cursor, or limit, THE MCP_Server SHALL apply only filters supported by each selected Repository and SHALL report any filter that could not be applied to a Repository.
5. THE MCP_Server SHALL default to 10 results and SHALL clamp the requested limit to the inclusive range 1 through 25.
6. WHEN more qualifying results remain, THE MCP_Server SHALL return an opaque Cursor that can retrieve the next federated page.
7. WHEN no Public_Record matches, THE MCP_Server SHALL return an empty results array, zero count, and a non-error message stating that no matching records were found.
8. IF one selected Repository is unavailable and another returns results, THEN THE MCP_Server SHALL return a Partial_Result rather than failing the complete search.

### Requirement 2: JScholarship Adapter

**User Story:** As a repository administrator, I want JScholarship searches to use its DSpace Discovery configuration and public API, so that MCP results match the repository's indexed metadata and access rules.

#### Acceptance Criteria

1. WHEN the JScholarship_Adapter receives a search request, THE JScholarship_Adapter SHALL query the private DSpace Solr <code>search</code> collection through the environment's Cloud Map endpoint.
2. THE JScholarship_Adapter SHALL map keyword, title, creator, author, subject, abstract, resource type, date, community, and collection concepts only through the JScholarship Field_Allowlist.
3. THE JScholarship_Adapter SHALL append non-overridable filters for DSpace items that are non-withdrawn, discoverable, latest-version, archived, and readable by the anonymous group.
4. WHEN a Candidate is selected for return, THE JScholarship_Adapter SHALL resolve it through DSpace REST and SHALL return it only if DSpace REST confirms it is a Public_Record.
5. WHEN a JScholarship Record_Summary is returned, THE JScholarship_Adapter SHALL include its UUID, Handle, canonical landing-page URL, public metadata, public file count when available, and public formats when available.
6. WHEN a full JScholarship Canonical_Record is requested, THE JScholarship_Adapter SHALL include public bitstream summaries.
7. IF DSpace REST cannot validate a Candidate, THEN THE JScholarship_Adapter SHALL omit the Candidate and SHALL NOT return Solr-only metadata for it.

### Requirement 3: JHRDR Adapter

**User Story:** As a data researcher, I want JHRDR results to preserve Dataverse dataset metadata and DOI semantics, so that I can evaluate and cite reusable research data accurately.

#### Acceptance Criteria

1. WHEN the JHRDR_Adapter receives a search request, THE JHRDR_Adapter SHALL query the private Dataverse Solr <code>collection1</code> collection through the environment's Cloud Map endpoint.
2. THE JHRDR_Adapter SHALL map keyword, title, author, affiliation, description, subject, keyword, publication date, and Dataverse collection concepts only through the JHRDR Field_Allowlist.
3. THE JHRDR_Adapter SHALL append non-overridable filters that restrict candidates to publicly published datasets and exclude drafts, deaccessioned versions, files, and Dataverse collection records.
4. WHEN a Candidate is selected for return, THE JHRDR_Adapter SHALL resolve the latest published version through the anonymous Dataverse Native API and SHALL return it only if the API confirms it is a Public_Record.
5. WHEN a JHRDR Record_Summary is returned, THE JHRDR_Adapter SHALL include its persistent identifier, DOI URL when present, canonical dataset URL, citation, license or terms, public metadata, public file count, and public formats when available.
6. WHEN a full JHRDR Canonical_Record is requested, THE JHRDR_Adapter SHALL include public file summaries.
7. IF a dataset file is restricted or cannot be confirmed public, THEN THE JHRDR_Adapter SHALL omit that file from the returned file summaries.
8. IF the Dataverse Native API cannot validate a Candidate, THEN THE JHRDR_Adapter SHALL omit the Candidate and SHALL NOT return Solr-only metadata for it.

### Requirement 4: Normalized Record and Provenance

**User Story:** As an MCP_Client, I want records from both systems in one stable schema, so that I can compare, group, and cite them without platform-specific parsing.

#### Acceptance Criteria

1. THE MCP_Server SHALL represent every Record_Summary with the fields <code>id</code>, <code>repository</code>, <code>kind</code>, <code>title</code>, <code>creators</code>, <code>date</code>, <code>abstract</code>, <code>subjects</code>, <code>resourceTypes</code>, <code>persistentId</code>, <code>citation</code>, <code>landingPageUrl</code>, <code>collection</code>, <code>access</code>, <code>fileCount</code>, <code>formats</code>, <code>matchedFields</code>, <code>snippet</code>, <code>sourceRank</code>, and <code>provenance</code>.
2. THE MCP_Server SHALL represent an unavailable optional value as <code>null</code> and an available multi-valued field with no values as an empty array.
3. THE MCP_Server SHALL namespace record IDs by Repository so that identifiers from different platforms cannot collide.
4. THE MCP_Server SHALL include the Canonical_API source, retrieval timestamp, platform type, and platform record identifier in <code>provenance</code>.
5. THE MCP_Server SHALL include a citation-ready persistent URL for every result.
6. THE MCP_Server SHALL NOT expose raw cross-repository Solr scores as confidence values.
7. THE MCP_Server SHALL return normalized data in MCP <code>structuredContent</code> and SHALL also return a compact text representation for client compatibility.

### Requirement 5: Get Item

**User Story:** As a researcher, I want full canonical metadata for a selected record, so that I can inspect its description, citation, rights, and available files.

#### Acceptance Criteria

1. WHEN an MCP_Client invokes <code>get_item</code> with a Repository and a valid namespaced ID, UUID, Handle, DOI, or Dataverse persistent identifier, THE MCP_Server SHALL resolve a full Canonical_Record using the selected Repository's Canonical_API.
2. WHEN the record is a Public_Record, THE MCP_Server SHALL return a Canonical_Record and no more than 100 public file or bitstream summaries.
3. IF the identifier is malformed, THEN THE MCP_Server SHALL reject it before calling Solr or a Canonical_API.
4. IF the identifier does not exist or identifies a non-public record, THEN THE MCP_Server SHALL return the same <code>not_found</code> response shape in both cases.
5. IF the Canonical_API is unavailable, THEN THE MCP_Server SHALL return a structured <code>backend_unavailable</code> tool error without exposing internal URLs or stack traces.

### Requirement 6: Faceted Refinement

**User Story:** As a researcher exploring an unfamiliar topic, I want facet counts across the repositories, so that I can refine the topic by people, subjects, dates, types, and collections.

#### Acceptance Criteria

1. WHEN an MCP_Client invokes <code>list_facets</code>, THE MCP_Server SHALL return approved common facets for repository, creator, subject, year, resource type, and collection.
2. WHEN a Repository has additional approved facets, THE MCP_Server MAY return them under a Repository-qualified facet name.
3. THE MCP_Server SHALL return no more than 10 values per facet, ordered by count descending and then label ascending.
4. THE MCP_Server SHALL calculate each facet only from records satisfying the same immutable public filters as <code>search_items</code>.
5. IF a requested facet is not allowlisted, THEN THE MCP_Server SHALL reject the request before querying either Solr backend.
6. WHEN no records match, THE MCP_Server SHALL return approved facet names with empty value arrays rather than an error.

### Requirement 7: Related Records

**User Story:** As a researcher, I want to find records related to a known publication or dataset, so that I can follow connections across repository boundaries.

#### Acceptance Criteria

1. WHEN an MCP_Client invokes <code>find_related_items</code>, THE MCP_Server SHALL first resolve the source as a Public_Record.
2. FOR a JScholarship source, THE MCP_Server SHALL derive related-record terms from allowlisted DSpace MoreLikeThis fields and canonical title, creator, subject, and abstract metadata.
3. FOR a JHRDR source, THE MCP_Server SHALL derive related-record terms from canonical title, author, subject, keyword, affiliation, and description metadata.
4. WHEN the Repository selector is <code>all</code>, THE MCP_Server SHALL search both Repositories using the derived terms.
5. THE MCP_Server SHALL exclude the source record, enforce all public filters, and return no more than the clamped limit of Canonical_Record results.
6. WHEN no related Public_Record is found, THE MCP_Server SHALL return an empty result array and a non-error message.

### Requirement 8: Search Explanation, Resources, and Prompts

**User Story:** As an MCP_Client, I want transparent search interpretation and guided workflows, so that the host model can refine searches without seeing backend syntax.

#### Acceptance Criteria

1. WHEN an MCP_Client invokes <code>explain_search</code>, THE MCP_Server SHALL describe the selected Repositories, human-readable searched fields, applied filters, sort, and any unsupported Repository-specific filter.
2. THE MCP_Server SHALL NOT include internal hostnames, Solr field names, raw query syntax, security filters, or credentials in an explanation.
3. THE MCP_Server SHALL expose resource templates for <code>jhu-repo://jscholarship/item/{encodedIdentifier}</code> and <code>jhu-repo://jhrdr/dataset/{encodedIdentifier}</code>, where <code>encodedIdentifier</code> is the percent-encoded Repository identifier.
4. WHEN a search or item tool returns a record, THE MCP_Server SHALL include an MCP resource link for that record.
5. THE MCP_Server SHALL expose <code>explore_research_topic</code> and <code>find_reusable_data</code> prompts that direct the host model to call tools iteratively, distinguish the two Repositories, cite Persistent_Identifiers, and state when a Repository was unavailable.
6. THE MCP_Server SHALL treat repository metadata as untrusted data and SHALL instruct prompts not to follow instructions found inside metadata fields.

### Requirement 9: Public-Access Enforcement

**User Story:** As a repository owner, I want every returned record checked against repository access rules, so that the MCP cannot disclose withdrawn, draft, deaccessioned, or restricted content.

#### Acceptance Criteria

1. THE MCP_Server SHALL apply Repository-specific immutable public filters to every Solr search, facet, and related-record query.
2. NO MCP_Client input SHALL remove, weaken, negate, or replace an immutable public filter.
3. THE MCP_Server SHALL validate every record selected for return through its Canonical_API.
4. IF a Candidate fails, times out, or cannot complete Canonical_API validation, THEN THE MCP_Server SHALL omit it.
5. THE MCP_Server SHALL NOT distinguish a nonexistent identifier from an identifier for a non-public record.
6. THE MCP_Server SHALL NOT return file-content or full-text snippets in v1, even when such text is stored in Solr.
7. THE MCP_Server SHALL include only metadata and links that an anonymous user can retrieve from the public repository interface.
8. THE MCP_Server SHALL keep full-text Solr query fields disabled unless Phase 0 demonstrates that every indexed value is publicly searchable and cannot disclose non-public file content through matching, ranking, facets, highlighting, or explanations.

### Requirement 10: Query Safety

**User Story:** As a platform engineer, I want structured, bounded query construction, so that an AI client cannot inject arbitrary Solr operations or overload either search cluster.

#### Acceptance Criteria

1. THE MCP_Server SHALL accept structured search fields and filters and SHALL NOT expose a raw Solr query parameter.
2. THE MCP_Server SHALL map every query field, filter, sort, facet, and related-record field through the applicable Field_Allowlist.
3. THE MCP_Server SHALL escape all user-supplied values using a Solr/Lucene-safe encoder before constructing a query.
4. THE MCP_Server SHALL reject unknown input properties and unsupported enum values before making a backend call.
5. THE MCP_Server SHALL restrict each Solr response field list to the minimum allowlisted fields needed by the requested operation.
6. THE MCP_Server SHALL set a bounded row count, query clause count, result window, and Solr <code>timeAllowed</code> value for every request.
7. THE MCP_Server SHALL call only Solr select, schema-read, faceting, and approved MoreLikeThis operations and SHALL NOT call Solr administration or update endpoints.

### Requirement 11: Federated Ranking and Pagination

**User Story:** As a researcher, I want balanced results from both repositories, so that the larger collection does not automatically dominate a cross-repository search.

#### Acceptance Criteria

1. THE MCP_Server SHALL preserve Repository_Rank produced by each Repository and SHALL NOT directly compare raw Solr relevance scores across Repositories.
2. WHEN merging two result lists, THE MCP_Server SHALL use a deterministic balanced reciprocal-rank method with equal default Repository weights.
3. THE MCP_Server SHALL include <code>sourceRank</code> and <code>repository</code> on every result and SHALL NOT label Federated_Rank as a probability or confidence.
4. THE Cursor SHALL contain a version, normalized query hash, and independent next positions for JScholarship and JHRDR.
5. IF a Cursor is malformed, has an unsupported version, or does not match the normalized query and filters, THEN THE MCP_Server SHALL reject it as invalid input.
6. FOR equivalent inputs and unchanged indexes, THE MCP_Server SHALL produce deterministic ordering and Cursor progression.

### Requirement 12: MCP Transport and Compatibility

**User Story:** As an MCP_Client developer, I want a standards-compliant remote MCP endpoint, so that I can connect using only the published server URL.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose MCP Streamable HTTP at <code>/mcp</code> using the official TypeScript MCP SDK.
2. THE MCP_Server SHALL operate without server-side session state and SHALL support multiple Fargate tasks without sticky sessions.
3. THE MCP_Server SHALL implement MCP initialization and SHALL advertise exactly the v1 tools, resources, and prompts defined in this specification.
4. THE MCP_Server SHALL validate tool inputs and outputs against JSON Schema and SHALL return <code>structuredContent</code> conforming to the advertised output schema.
5. THE MCP_Server SHALL return standard JSON-RPC protocol errors for malformed protocol messages and actionable MCP tool errors for valid calls that fail validation or execution.
6. THE MCP_Server SHALL implement graceful shutdown so that the load balancer can drain active requests during a deployment.
7. THE MCP_Server SHALL be implemented in strict TypeScript and SHALL use a pinned Bun release as its runtime, package manager, build tool, and test runner in development, CI, and the production container.
8. THE MCP_Server SHALL use the official MCP TypeScript SDK's Web Standard Streamable HTTP transport for Bun and SHALL NOT depend on the Node.js-specific MCP HTTP transport.

### Requirement 13: Fargate Deployment and Networking

**User Story:** As a platform engineer, I want the MCP deployed next to both repositories, so that searches and canonical lookups remain private, low latency, and independently operable.

#### Acceptance Criteria

1. THE MCP_Server SHALL run as one ECS Fargate service per environment in private subnets within the VPC shared by the matching DSpace and Dataverse deployments.
2. THE MCP_Server SHALL use <code>solr.dspace-{environment}.local:8983/solr/search</code> for JScholarship candidate retrieval.
3. THE MCP_Server SHALL use <code>solr.dataverse-{environment}.internal:8983/solr/collection1</code> for JHRDR candidate retrieval.
4. THE MCP_Server SHALL reach DSpace REST through a private DSpace endpoint and SHALL reach Dataverse on port 8080 through <code>dataverse.dataverse-{environment}.internal</code>.
5. THE MCP_Server SHALL have a dedicated security group whose ingress permits only the MCP load balancer and whose egress permits only required repository, DNS, and AWS service traffic.
6. THE infrastructure SHALL add explicit MCP security-group ingress rules to both Solr security groups and to the Canonical_API targets.
7. THE stage service SHALL run at least one task; THE production service SHALL run at least two tasks across available private subnets and SHALL support autoscaling from two through six tasks.
8. THE default task size SHALL be 512 CPU units and 1024 MiB memory and SHALL be configurable per environment.
9. THE MCP_Server SHALL expose dependency-free liveness and readiness endpoints for ECS and load-balancer health checks.

### Requirement 14: Edge Security and Access Model

**User Story:** As a service owner, I want a low-friction public pilot with strong abuse controls, so that researchers can connect without exposing private infrastructure.

#### Acceptance Criteria

1. THE v1 MCP endpoint SHALL allow anonymous read-only use and SHALL NOT accept repository credentials, Dataverse API tokens, DSpace authentication tokens, or end-user identity attributes.
2. THE MCP_Server SHALL be exposed only through HTTPS on a dedicated public hostname, load-balancer target group, and WAF-protected route.
3. THE MCP_Server SHALL validate the HTTP Host header against an allowlist.
4. WHEN an Origin header is present, THE MCP_Server SHALL return HTTP 403 unless the origin is in the configured allowlist.
5. THE WAF SHALL enforce managed common-threat protections, a request-size bound, and an IP-based rate limit scoped to the MCP endpoint.
6. THE MCP_Server SHALL apply an application-level concurrency bound per task so that WAF-approved traffic cannot exhaust repository backends.
7. THE v1 deployment SHALL NOT require OAuth; any future authorization design SHALL be handled as a separate specification.

### Requirement 15: Resilience, Caching, and Observability

**User Story:** As a service owner, I want bounded failure handling and privacy-preserving telemetry, so that I can operate the MCP without collecting researchers' questions.

#### Acceptance Criteria

1. THE MCP_Server SHALL impose configurable per-call timeouts on each Solr and Canonical_API request and an overall tool deadline no greater than 10 seconds.
2. THE MCP_Server SHALL retry only idempotent transient failures, use exponential backoff with jitter, and make no more than two total attempts per backend call.
3. WHEN one Repository fails during an <code>all</code> search, THE MCP_Server SHALL return available results with a Repository-qualified warning.
4. THE MCP_Server MAY cache public search responses for up to 60 seconds and Canonical_Record responses for up to 5 minutes using bounded in-process caches.
5. THE MCP_Server SHALL log structured events containing timestamp, request ID, client name and version when supplied, tool, Repository, latency, result count, cache status, outcome, and backend status.
6. THE MCP_Server SHALL NOT log raw search text, filter values, prompts, conversation content, record abstracts, user identity, access tokens, or response bodies.
7. THE MCP_Server SHALL publish CloudWatch metrics for invocation count, latency, errors, zero-result searches, Partial_Result responses, backend availability, validation omissions, cache hits, and rate-limit events.
8. THE MCP_Server SHALL expose build version and commit identifier in health metadata and logs.

### Requirement 16: Verification and Pilot Evaluation

**User Story:** As a library product owner, I want measurable technical and discovery-quality gates, so that production release is based on evidence rather than demonstration alone.

#### Acceptance Criteria

1. THE test suite SHALL include known withdrawn, private, draft, deaccessioned, and restricted fixtures and SHALL demonstrate that none are returned by any tool or resource.
2. THE test suite SHALL verify that every tool output conforms to its advertised JSON Schema.
3. THE stage evaluation SHALL include at least 40 benchmark queries covering known-item lookup, topical discovery, author search, subject refinement, dataset discovery, exact Persistent_Identifier lookup, and cross-repository exploration.
4. THE benchmark SHALL achieve at least 95 percent success on known-item and exact Persistent_Identifier queries.
5. UNDER the agreed pilot load, THE federated search p95 SHALL be no greater than 3 seconds when both repositories are healthy.
6. THE compatibility suite SHALL complete initialization, tool listing, tool calls, resource reads, prompt retrieval, and shutdown using the target MCP clients.
7. THE pilot SHALL record relevance judgments, citation correctness, time to a useful result, number of search iterations, zero-result rate, and user trust feedback without storing raw private research questions.
8. Production deployment SHALL require explicit sign-off from JScholarship, JHRDR, library research-services, and platform-operation owners.

### Requirement 17: Scope Boundaries

**User Story:** As a project sponsor, I want a disciplined first release, so that the pilot can test trustworthy discovery before adding higher-risk capabilities.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide no deposit, edit, delete, publish, deaccession, embargo, permission, user, administrative, or statistics operation.
2. THE MCP_Server SHALL contain no embedded LLM, generated summary, vector database, embedding pipeline, or autonomous agent loop.
3. THE MCP_Server SHALL not proxy file bytes, bulk downloads, restricted data, or authenticated repository sessions.
4. THE MCP_Server SHALL not expose raw Solr access, arbitrary URLs, arbitrary HTTP requests, database access, filesystem access, or code execution.
5. THE MCP_Server SHALL treat host-model synthesis as outside its responsibility and SHALL return attributable repository evidence only.
6. Any capability excluded by this requirement SHALL require a new or revised Kiro specification before implementation.
