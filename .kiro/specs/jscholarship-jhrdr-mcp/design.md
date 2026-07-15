# Design Document: JScholarship/JHRDR MCP Server

## Overview

The JScholarship/JHRDR MCP Server is a read-only, federated repository-discovery service implemented in strict TypeScript on Bun with the official Model Context Protocol TypeScript SDK. It exposes one stateless Streamable HTTP endpoint at <code>/mcp</code> and runs as an ECS Fargate service in the AWS VPC shared by the JScholarship and JHRDR deployments.

The service does not attempt to make DSpace and Dataverse look identical internally. It uses a common adapter contract and a normalized public result model while preserving platform-specific query fields, identifiers, access rules, canonical APIs, and landing pages.

The v1 MCP surface is fixed:

| Primitive | Name | Responsibility |
| --- | --- | --- |
| Tool | <code>search_items</code> | Search one or both repositories with structured filters and federated pagination |
| Tool | <code>get_item</code> | Resolve a selected public record through its canonical repository API |
| Tool | <code>list_facets</code> | Return approved common and repository-qualified facets |
| Tool | <code>find_related_items</code> | Discover related records within or across repositories |
| Tool | <code>explain_search</code> | Explain interpreted fields and filters without backend syntax |
| Resource | <code>jhu-repo://jscholarship/item/{encodedIdentifier}</code> | Read a canonical JScholarship record |
| Resource | <code>jhu-repo://jhrdr/dataset/{encodedIdentifier}</code> | Read a canonical JHRDR dataset |
| Prompt | <code>explore_research_topic</code> | Guide an iterative, cited search across repository materials |
| Prompt | <code>find_reusable_data</code> | Guide dataset discovery and evaluation using JHRDR and related JScholarship records |

### Goals and Requirement Mapping

| Goal | Requirements |
| --- | --- |
| Unified, citation-ready discovery | 1, 4, 5 |
| Correct DSpace behavior | 2 |
| Correct Dataverse behavior | 3 |
| Faceted and iterative exploration | 6, 7, 8 |
| Fail-closed public access | 9 |
| Injection-proof, bounded Solr use | 10 |
| Balanced federation and pagination | 11 |
| Standards-compliant remote MCP | 12 |
| Private, low-latency AWS placement | 13 |
| Public pilot with edge safeguards | 14 |
| Operability and privacy | 15 |
| Evidence-based release | 16 |
| Disciplined v1 scope | 17 |

## Architectural Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Deployment shape | One MCP service per environment | Both repository deployments use the same VPC and private subnets, so a gateway plus remote adapter services would add operational complexity without a network benefit |
| Application runtime | Pinned Bun release with strict TypeScript | Bun provides the runtime, package manager, bundler, and test runner; one pinned version keeps local, CI, and container behavior reproducible |
| HTTP integration | Hono and the MCP Web Standard Streamable HTTP transport | The official MCP SDK supports Bun through Web Standard APIs and avoids coupling the service to the Node.js HTTP transport |
| Repository integration | Two platform-specific adapters behind one interface | JScholarship is DSpace and JHRDR is Dataverse; canonical APIs and access semantics cannot safely be collapsed below the adapter boundary |
| Search path | Direct private Solr for candidates, Canonical_API for every returned record | Solr supplies fast search, facets, and related signals; the repository API remains the public-access authority |
| Transport | Stateless MCP Streamable HTTP with JSON responses | Enables multiple Fargate tasks without sticky sessions, Redis, or session routing |
| Ranking | Repository-local relevance plus balanced reciprocal-rank merge | Raw scores from separately configured Solr indexes are not comparable |
| Access model | Anonymous, read-only v1 | Both repositories publish public material; authentication would add friction without expanding authorized data |
| Semantics | Host model performs synthesis | The MCP returns evidence and citations; it does not embed an LLM or vector search system |
| Infrastructure ownership | New cross-repository service stack | The MCP belongs to neither repository alone and should be deployable independently |

## Architecture

### System Context

~~~mermaid
flowchart LR
    Client["MCP Client<br/>HopGPT, Claude, or another host"]
    DNS["Public DNS / optional Cloudflare proxy"]
    WAF["AWS WAF<br/>host, threat, size, rate rules"]
    ALB["Dedicated public ALB<br/>TLS termination"]

    subgraph SharedVPC["Shared repository VPC"]
        subgraph PrivateSubnets["Private subnets"]
            MCP1["MCP Fargate task A<br/>Bun, stateless"]
            MCP2["MCP Fargate task B<br/>Bun, stateless"]
        end

        subgraph JScholarship["JScholarship / DSpace"]
            JSSolr["SolrCloud search collection<br/>solr.dspace-{env}.local:8983"]
            DSpaceAPI["DSpace REST<br/>private endpoint:8080"]
        end

        subgraph JHRDR["JHRDR / Dataverse"]
            DVSolr["Dataverse Solr collection1<br/>solr.dataverse-{env}.internal:8983"]
            DVAPI["Dataverse Native API<br/>dataverse.dataverse-{env}.internal:8080"]
        end
    end

    Client -->|HTTPS MCP| DNS --> WAF --> ALB
    ALB --> MCP1
    ALB --> MCP2
    MCP1 --> JSSolr
    MCP1 --> DSpaceAPI
    MCP1 --> DVSolr
    MCP1 --> DVAPI
    MCP2 --> JSSolr
    MCP2 --> DSpaceAPI
    MCP2 --> DVSolr
    MCP2 --> DVAPI
~~~

The ECS cluster is a logical scheduling boundary and does not affect network proximity. The MCP may use a dedicated cluster while its tasks attach ENIs to the shared private subnets. Production runs at least two tasks distributed across available subnets. (Requirements 13.1, 13.7)

### Internal Endpoints

| Dependency | Stage | Production | Protocol |
| --- | --- | --- | --- |
| JScholarship Solr | <code>solr.dspace-stage.local:8983/solr/search</code> | <code>solr.dspace-prod.local:8983/solr/search</code> | HTTP inside VPC |
| DSpace REST | Private DSpace API endpoint | Private DSpace API endpoint | HTTP inside VPC |
| JHRDR Solr | <code>solr.dataverse-stage.internal:8983/solr/collection1</code> | <code>solr.dataverse-prod.internal:8983/solr/collection1</code> | HTTP inside VPC |
| Dataverse API | <code>dataverse.dataverse-stage.internal:8080/api</code> | <code>dataverse.dataverse-prod.internal:8080/api</code> | HTTP inside VPC |

Endpoint values are environment configuration, not client input. Startup validation ensures each Solr collection exposes its required field manifest before the task becomes ready. (Requirements 10.2, 13.2-13.4)

## Request Flows

### Federated Search

~~~mermaid
sequenceDiagram
    participant C as MCP_Client
    participant H as search_items handler
    participant V as Validation
    participant F as Federation service
    participant JS as JScholarship_Adapter
    participant DV as JHRDR_Adapter
    participant DS as DSpace REST
    participant DA as Dataverse API

    C->>H: tools/call search_items
    H->>V: Validate schema, filters, cursor, bounds
    alt Invalid input
        V-->>C: invalid_input or unsupported_parameter
    else Valid input
        V->>F: Normalized SearchRequest
        par JScholarship branch
            F->>JS: search(request, cursor.jsOffset)
            JS->>JS: Build allowlisted query + immutable public filters
            JS->>JS: Query private Solr search collection
            loop Selected candidate page
                JS->>DS: Resolve and validate public item
                DS-->>JS: Canonical public metadata or rejection
            end
            JS-->>F: RepositoryPage
        and JHRDR branch
            F->>DV: search(request, cursor.dvOffset)
            DV->>DV: Build allowlisted query + immutable published filters
            DV->>DV: Query private Solr collection1
            loop Selected candidate page
                DV->>DA: Resolve latest published dataset
                DA-->>DV: Canonical public metadata or rejection
            end
            DV-->>F: RepositoryPage
        end
        F->>F: Balanced reciprocal-rank merge
        F->>F: Encode next per-repository Cursor
        F-->>H: Federated SearchResponse
        H-->>C: structuredContent + compact text + resource links
    end
~~~

Canonicalization is applied only to the selected candidate window, not every hit in each Solr result set. Candidates that cannot pass canonicalization are dropped; the adapter may fetch additional candidates up to a fixed over-fetch ceiling to fill the requested page. The ceiling prevents a damaged index or API outage from creating an unbounded call fan-out. (Requirements 2.4-2.6, 3.4-3.7, 9.3-9.4)

### Get Item

~~~mermaid
sequenceDiagram
    participant C as MCP_Client
    participant H as get_item handler
    participant V as Identifier validation
    participant A as Repository adapter
    participant API as Canonical_API

    C->>H: get_item {repository, identifier}
    H->>V: Validate repository and identifier form
    alt Invalid
        V-->>C: invalid_input
    else Valid
        V->>A: get(identifier)
        A->>API: Anonymous canonical lookup
        alt Public record
            API-->>A: Canonical metadata
            A-->>H: Canonical_Record
            H-->>C: record + resource link
        else Non-public or nonexistent
            API-->>A: unavailable to anonymous user
            A-->>C: indistinguishable not_found
        else Backend unavailable
            A-->>C: backend_unavailable
        end
    end
~~~

## Components and Interfaces

### 1. HTTP and MCP Transport

A Hono application running on Bun hosts:

- <code>POST /mcp</code> and any GET behavior required by the negotiated MCP Streamable HTTP transport.
- <code>GET /health/live</code>, which reports process liveness without calling dependencies.
- <code>GET /health/ready</code>, which reports whether configuration and startup schema validation succeeded.
- <code>GET /version</code>, available only through the internal target path or included in health metadata.

The MCP integration uses <code>@modelcontextprotocol/server</code>, <code>@modelcontextprotocol/hono</code>, and <code>WebStandardStreamableHTTPServerTransport</code>. It does not use the Node.js-specific <code>@modelcontextprotocol/node</code> transport. The transport uses stateless JSON response mode. A transport instance and MCP server are created for each request when required by the SDK's stateless pattern. No MCP session identifier is issued and no task stores conversational state. The server handles SIGTERM by stopping new requests, draining Bun's HTTP server, and exiting before the ECS stop timeout. (Requirements 12.1-12.8, 13.9)

The HTTP layer enforces:

- Request body and header size limits.
- Host allowlisting.
- Origin allowlisting when Origin is present.
- Request correlation IDs.
- Overall request deadline.
- Application-level concurrency semaphore.

### 2. MCP Registry

The registry is static and centralized. It registers exactly the five tools, two resource templates, and two prompts listed in the Overview. Tool definitions include:

- A concise title and description that distinguish JScholarship from JHRDR.
- Closed JSON input schemas with <code>additionalProperties: false</code>.
- JSON output schemas for every successful result.
- Read-only tool annotations where supported by the SDK.
- Both <code>structuredContent</code> and serialized text output.

The registry contains no dynamic tool creation and no write, admin, identity, download, HTTP-fetch, database, or code-execution capability. (Requirements 12.3-12.5, 17)

### 3. Repository Adapter Contract

~~~ts
type RepositoryId = "jscholarship" | "jhrdr";

interface RepositoryAdapter {
  readonly id: RepositoryId;

  validateSchema(): Promise<SchemaValidationResult>;
  search(request: RepositorySearchRequest): Promise<RepositoryPage>;
  get(identifier: RepositoryIdentifier): Promise<CanonicalRecord | null>;
  facets(request: RepositoryFacetRequest): Promise<RepositoryFacets>;
  related(source: CanonicalRecord, request: RelatedRequest): Promise<RepositoryPage>;
}

interface RepositoryPage {
  repository: RepositoryId;
  results: RepositoryRecord[];
  nextOffset: number | null;
  totalCandidates: number;
  validationOmissions: number;
  warnings: RepositoryWarning[];
}
~~~

Adapters own all platform-specific knowledge. The federation and MCP layers cannot name a Solr field, construct a repository URL, or decide whether a platform record is public. (Requirements 2, 3, 9, 10)

### 4. Repository Profiles and Field Allowlists

Each environment loads two immutable RepositoryProfile objects:

~~~ts
interface RepositoryProfile {
  id: RepositoryId;
  platform: "dspace" | "dataverse";
  solrBaseUrl: URL;
  apiBaseUrl: URL;
  publicBaseUrl: URL;
  requiredSchemaFields: string[];
  optionalSchemaFields: string[];
  queryFields: Record<SearchField, WeightedField[]>;
  filterFields: Partial<Record<CommonFilter, SolrField>>;
  facetFields: Partial<Record<CommonFacet, SolrField>>;
  sortFields: Partial<Record<SortOption, SolrSort>>;
  immutablePublicFilters: SolrFilterFactory[];
}
~~~

Profiles are compiled with the application and parameterized only for endpoint hostnames and public base URLs. They are not downloaded from client-supplied locations. At startup, the server calls Solr's read-only Schema API and confirms required fields. Missing required fields fail readiness; missing optional fields disable the corresponding optional facet and emit a metric. (Requirements 10.2, 10.7, 13.9)

#### JScholarship Field Map

| MCP concept | DSpace Solr field basis |
| --- | --- |
| keyword | <code>dc.title</code>, <code>dc.contributor.author</code>, <code>dc.creator</code>, <code>dc.subject</code>, <code>dc.description.abstract</code>; optionally <code>fulltext</code> only after the Phase 0 public-content proof |
| title | <code>dc.title</code> |
| creator | <code>dc.contributor.author</code>, <code>dc.creator</code> |
| subject | <code>dc.subject</code> and its deployed filter field |
| date | issued-year/date fields from Discovery configuration |
| type | deployed <code>dc.type</code> filter field |
| collection | <code>location.coll</code> |
| community | <code>location.comm</code> |
| system identity | <code>search.resourceid</code>, <code>search.resourcetype</code>, <code>handle</code> |
| public gate | <code>withdrawn</code>, <code>discoverable</code>, <code>latestVersion</code>, <code>database_status</code>, <code>read</code> |
| related | allowlisted <code>*_mlt</code> fields derived from title, creator, subject, and abstract |

Exact generated Discovery field names are confirmed against the deployed schema and known public and non-public fixtures before enabling the adapter. Full-text fields remain disabled unless Phase 0 proves all indexed values are publicly searchable and cannot reveal non-public content through matching, ranking, facets, highlighting, or explanations. Even when enabled, full text may influence rank but is never returned. (Requirements 2, 9.6-9.8)

#### JHRDR Field Map

Dataverse combines static SearchFields with metadata-block-driven fields. The adapter therefore ships a versioned 6.10.1-compatible manifest and validates it against the deployed <code>collection1</code> schema.

| MCP concept | Dataverse field source |
| --- | --- |
| keyword | indexed aggregate text plus approved citation metadata fields |
| title | citation metadata <code>title</code> field |
| creator | citation metadata author-name field |
| affiliation | citation metadata author-affiliation field |
| description | citation metadata dataset-description-value field |
| subject | citation metadata controlled subject field |
| keyword | citation metadata keyword-value field |
| date | published/date-sort field |
| collection | parent Dataverse name or identifier field |
| persistent identifier | dataset persistent-ID/global-ID field |
| system type | static record-type field restricted to datasets |
| public gate | static publication-status/version fields confirmed for the deployed Dataverse release |

Because Dataverse metadata blocks can change independently, the implementation must not guess unavailable fields. Unsupported optional concepts are reported to the federation layer, while missing system type or publication fields fail readiness. (Requirements 3, 9, 10)

### 5. Safe Solr Query Builder

Both adapters use one generic query builder parameterized by a RepositoryProfile. The builder:

1. Accepts only normalized domain fields and filters.
2. Resolves every concept through the repository Field_Allowlist.
3. Escapes user values with a tested Lucene/Solr encoder.
4. Appends immutable public filters in a separate, non-client-accessible step.
5. Uses <code>edismax</code> or the repository's compatible parser with explicit query fields and boosts.
6. Uses POST form parameters for bounded query payloads.
7. Sets explicit <code>fl</code>, <code>rows</code>, <code>start</code>, sort, facet bounds, and <code>timeAllowed</code>.
8. Rejects attempts to supply raw query fragments, local parameters, arbitrary fields, or Solr request-handler paths.

~~~ts
interface SafeSolrQuery {
  path: "/select" | "/mlt";
  params: URLSearchParams;
  expectedFields: ReadonlySet<string>;
}

function buildQuery(
  profile: RepositoryProfile,
  request: RepositorySearchRequest
): SafeSolrQuery;
~~~

The Solr HTTP client is initialized with a fixed collection base URL. It cannot follow redirects to another host and cannot call update or administrative paths. (Requirement 10)

### 6. Canonical API Clients

#### DSpace REST Client

The DSpace client uses anonymous private REST endpoints to:

- Resolve an item by UUID or Handle.
- Fetch item metadata.
- Resolve collection/community context.
- Enumerate public ORIGINAL bundle bitstreams, capped at 100.
- Resolve a public thumbnail when present.

The public gate verifies the item is retrievable anonymously and satisfies the DSpace state requirements. Any mismatch between Solr and REST fails closed. The public landing page uses the configured public JScholarship base URL and Handle. (Requirements 2, 5, 9)

#### Dataverse Native API Client

The Dataverse client uses anonymous internal HTTP endpoints to:

- Resolve a dataset by persistent identifier.
- Request the latest published version, never <code>:draft</code> or <code>:latest</code>.
- Read citation metadata blocks, citation, license or terms, version, and file summaries.
- Exclude restricted files.
- Construct the canonical public dataset URL using the persistent identifier.

The client does not send an <code>X-Dataverse-key</code> header or Bearer token. Deaccessioned, draft, restricted, or otherwise anonymous-inaccessible records are treated as not found. (Requirements 3, 5, 9, 14.1)

### 7. Normalization

Platform payloads are mapped to normalized search summaries or full item records only after public validation. Normalization:

- Preserves all creators and subjects in source order.
- Normalizes dates to ISO 8601 where available while retaining a display value when the source is less precise.
- Preserves the repository-supplied citation when available.
- Creates a conservative fallback citation only from canonical metadata when the platform does not supply one.
- Sanitizes control characters and markup without rewriting the scholarly content.
- Caps snippets at 300 characters and derives them only from public metadata.
- Treats all metadata text as untrusted data, never executable instructions.

### 8. Federation, Ranking, and Cursor

Each adapter retrieves a bounded candidate window and returns canonicalized records with Repository_Rank. Raw scores remain private to the adapter.

For an <code>all</code> search, the federation service calculates:

<code>fusionScore = repositoryWeight / (60 + repositoryRank)</code>

Default weights are equal. Results are ordered by fusion score. Equal-rank ties use a deterministic alternating source selected from the Cursor's <code>nextTieSource</code>, preventing one repository from always winning ties. A stable namespaced ID is the final tie-breaker.

~~~ts
interface FederatedCursorV1 {
  v: 1;
  queryHash: string;
  jsOffset: number;
  dvOffset: number;
  nextTieSource: RepositoryId;
}
~~~

The cursor is canonical-JSON encoded and base64url encoded. The query hash covers the normalized query, selected repositories, filters, sort, and limit. Cursor decoding validates types, version, non-negative bounded offsets, and query hash. The service is stateless because all required paging state is in the Cursor. (Requirement 11)

If one adapter fails, federation returns the successful RepositoryPage plus a warning:

~~~json
{
  "repository": "jhrdr",
  "code": "backend_unavailable",
  "message": "JHRDR was temporarily unavailable; results include JScholarship only."
}
~~~

Warnings never contain internal endpoints or exception text. (Requirements 1.8, 15.3)

### 9. Caching and Concurrency

Each task uses bounded in-process LRU caches:

| Cache | Key | Maximum TTL | Purpose |
| --- | --- | --- | --- |
| Search | Hash of normalized adapter request | 60 seconds | Absorb repeated AI iterations and identical client retries |
| Canonical record | Repository plus canonical identifier | 5 minutes | Reduce repeated REST/Native API validation |
| Schema validation | Repository profile version | Process lifetime | Avoid repeated schema reads |

Cache entries contain public normalized data only. No user identity, raw query, token, or conversation is cached. Cache absence on another task affects performance only, not correctness.

A per-task semaphore limits concurrent tool calls and a lower per-repository semaphore limits canonicalization fan-out. Canonical lookups use a fixed worker pool rather than unbounded <code>Promise.all</code>. (Requirements 14.6, 15.4)

### 10. MCP Inputs and Outputs

#### Common Search Input

~~~ts
interface SearchItemsInput {
  query: string;
  repositories?: "all" | RepositoryId;
  field?: "keyword" | "title" | "creator" | "subject" | "abstract";
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    resourceTypes?: string[];
    creators?: string[];
    subjects?: string[];
    collections?: string[];
    access?: "open" | "metadata_only";
  };
  sort?: "relevance" | "date_asc" | "date_desc" | "title_asc";
  cursor?: string;
  limit?: number;
}
~~~

Closed JSON schemas reject unknown properties at every object level. Date values must be ISO dates or four-digit years. Array lengths, string lengths, and nesting depth are bounded. (Requirements 1, 10)

#### Normalized Data Model

~~~ts
interface RepositoryRecord {
  id: string;                       // "jscholarship:<uuid>" or "jhrdr:<persistent-id>"
  repository: RepositoryId;
  kind: "repository_item" | "dataset";
  title: string;
  creators: Creator[];
  date: {
    value: string | null;
    display: string | null;
    precision: "day" | "month" | "year" | "unknown";
  };
  abstract: string | null;
  subjects: string[];
  resourceTypes: string[];
  persistentId: {
    type: "handle" | "doi" | "other";
    value: string;
    url: string;
  } | null;
  citation: string | null;
  landingPageUrl: string;
  collection: {
    id: string | null;
    name: string | null;
    path: string[];
  };
  access: {
    status: "open" | "metadata_only";
    license: string | null;
    terms: string | null;
  };
  fileCount: number;
  formats: string[];
  matchedFields: string[];
  snippet: string | null;
  sourceRank: number | null;
  provenance: {
    platform: "dspace" | "dataverse";
    platformRecordId: string;
    canonicalApi: "dspace_rest" | "dataverse_native_api";
    retrievedAt: string;
  };
}

interface CanonicalRecord extends RepositoryRecord {
  files: PublicFileSummary[];
}

interface Creator {
  name: string;
  affiliation: string | null;
  identifier: string | null;
}

interface PublicFileSummary {
  id: string;
  name: string;
  format: string | null;
  sizeBytes: number | null;
  restricted: false;
  downloadUrl: string | null;
}
~~~

Search and related tools return <code>RepositoryRecord</code> summaries. <code>get_item</code> and item resources return <code>CanonicalRecord</code> with the expanded <code>files</code> array. Optional values are required-but-nullable so clients receive a stable object shape. Files are capped at 100; <code>fileCount</code> records the public count reported by the canonical platform and may exceed the returned file-summary length. (Requirements 4, 5)

#### Search Response

~~~ts
interface SearchItemsOutput {
  results: RepositoryRecord[];
  count: number;
  cursor: string | null;
  repositories: {
    requested: ("jscholarship" | "jhrdr")[];
    succeeded: ("jscholarship" | "jhrdr")[];
    failed: ("jscholarship" | "jhrdr")[];
  };
  warnings: RepositoryWarning[];
  facets?: CommonFacetResult[];
  retrievedAt: string;
}
~~~

The text content is a concise numbered list of title, creator/date, repository, persistent identifier, and landing-page URL. It does not serialize large abstracts or all file summaries. The complete object is in <code>structuredContent</code>. (Requirement 4.7)

### 11. Facets and Related Records

Common facets are normalized by concept, not raw backend field:

| Common facet | JScholarship source | JHRDR source |
| --- | --- | --- |
| repository | Constant adapter ID | Constant adapter ID |
| creator | DSpace author/creator facet | Dataverse author-name facet |
| subject | DSpace subject facet | Dataverse subject/keyword facets |
| year | DSpace issued-year facet | Dataverse publication-date facet |
| resource type | DSpace type facet | Dataset type / metadata resource type |
| collection | DSpace collection hierarchy | Parent Dataverse |

Counts from separate repositories are returned with a per-repository breakdown and a summed total only for labels that normalize to the exact same case-folded value. The response never implies that two differently controlled vocabularies are equivalent merely because they are similar. (Requirement 6)

Related-record discovery is metadata-based:

- JScholarship uses deployed DSpace <code>*_mlt</code> fields where available.
- JHRDR builds an allowlisted query from public citation metadata.
- Cross-repository related search maps canonical source metadata to common concepts.
- No embeddings or LLM-generated expansion occurs in v1.

### 12. Error Handling

| Error type | Situation | MCP behavior |
| --- | --- | --- |
| <code>invalid_input</code> | Bad query, identifier, cursor, date, or limit | Tool error with corrective message; no backend call |
| <code>unsupported_parameter</code> | Field/filter/facet unavailable for all selected repositories | Tool error naming supported concepts |
| <code>not_found</code> | Nonexistent or non-public record | Indistinguishable not-found result |
| <code>backend_unavailable</code> | One requested repository fails | Warning plus Partial_Result when possible; tool error when no repository succeeds |
| <code>deadline_exceeded</code> | Overall 10-second deadline reached | Tool error or Partial_Result if usable results already exist |
| <code>rate_limited</code> | Edge or application concurrency bound reached | HTTP/WAF response or structured tool error with retry guidance |
| <code>capability_unavailable</code> | Client requests excluded operation | Explicit read-only capability error |

Protocol framing and malformed JSON-RPC errors are emitted as JSON-RPC errors. Domain validation and execution failures are MCP tool errors with <code>isError: true</code> where appropriate. Internal URLs, request bodies, stack traces, Solr queries, and platform exception messages never reach the client. (Requirements 5, 12.5, 15)

### 13. Security Design

#### Network Controls

- Dedicated ALB security group: inbound 443 only.
- Dedicated MCP task security group: inbound application port only from the ALB security group.
- DSpace Solr SG: new 8983 ingress from MCP task SG.
- Dataverse Solr SG: new 8983 ingress from MCP task SG.
- Dataverse app SG: new 8080 ingress from MCP task SG.
- DSpace private API path: explicit ingress from MCP SG or private ALB route, depending on the final endpoint selected in Phase 0.
- MCP egress: DNS, the four repository dependencies, and required AWS endpoints only.

Cross-stack security-group rules are owned by the MCP infrastructure stack using IDs exported from the repository stacks. This avoids circular remote-state dependencies. Repository stacks expose IDs but do not depend on the MCP stack. (Requirement 13)

#### Application and Edge Controls

- TLS 1.2 or newer at the ALB.
- Exact public Host allowlist.
- Configured Origin allowlist; missing Origin remains valid for non-browser MCP clients.
- WAF common-threat, known-bad-input, body-size, and endpoint-scoped IP rate rules.
- Closed JSON schemas and bounded body size.
- Fixed outbound hosts and no redirect following across hosts.
- Metadata sanitization and prompt instructions that metadata is untrusted.
- No repository credentials or user tokens.
- No file-content proxy.

OAuth is intentionally absent in v1. If protected data or user-specific capabilities are proposed, the authorization model must follow a new specification rather than adding ad hoc API keys. (Requirements 14, 17)

### 14. Infrastructure and Delivery

The preferred implementation lives in a new repository named <code>jhu-repository-mcp</code>. The repository contains:

~~~text
.bun-version
bun.lock
bunfig.toml
package.json
tsconfig.json
src/
  adapters/
    jscholarship/
    jhrdr/
  federation/
  mcp/
  models/
  observability/
  security/
config/
  repositories/
infra/
  modules/repository-mcp/
  stage.tfvars
  prod.tfvars
aws-ecs-task-defs/
test/
  fixtures/
  integration/
  property/
~~~

The OpenTofu stack reads DSpace and Dataverse remote-state outputs for VPC, private subnets, repository security groups, private endpoints, and existing alert topics. It creates:

- Dedicated ECS cluster and Fargate service.
- Task execution and minimal runtime IAM roles.
- Immutable ECR repository with scan-on-push.
- Dedicated public ALB, target group, ACM certificate, and WAF.
- MCP task and ALB security groups plus cross-stack ingress-rule resources.
- CloudWatch log group, dashboard, alarms, and autoscaling policy.
- Route 53 or documented DNS outputs for the public hostname.

The repository commits the text <code>bun.lock</code> lockfile and pins one approved Bun version in <code>.bun-version</code>. The same version is used by the official Bun setup action and every Docker stage. CI installs with <code>bun ci</code>, type-checks with <code>tsc --noEmit</code>, tests with <code>bun test</code>, and builds with <code>bun build --target=bun --production</code>. Bun's bundler does not replace TypeScript type-checking.

Stage runs one task by default. Production runs two tasks and autoscaling from two through six tasks based on CPU and ALB request count. The multi-stage container uses a version-and-digest-pinned official <code>oven/bun</code> image, copies only the Bun-targeted production bundle and required runtime files into the final image, runs as the non-root <code>bun</code> user, has a read-only root filesystem where supported, contains a health check, and embeds source commit/version labels. No Node.js runtime or development dependencies are installed in the final image. (Requirements 12.7-12.8, 13-16)

The deployment pipeline follows the repository patterns already used by JScholarship and JHRDR:

1. Install reproducibly with <code>bun ci</code>, type-check, test with <code>bun test</code>, and build the Bun-targeted production bundle.
2. Generate SBOM and scan image.
3. Push immutable stage image.
4. Deploy to stage and run smoke/compatibility tests.
5. Promote the exact image digest to production.
6. Run post-deployment smoke tests and rollback automatically on failed target health.

### 15. Observability and Privacy

Each tool invocation emits one structured summary event:

~~~json
{
  "timestamp": "2026-07-14T15:00:00Z",
  "requestId": "uuid",
  "client": {"name": "example-host", "version": "1.0"},
  "tool": "search_items",
  "repositories": ["jscholarship", "jhrdr"],
  "latencyMs": 842,
  "resultCount": 10,
  "partial": false,
  "cache": "miss",
  "backendStatus": {
    "jscholarship": "ok",
    "jhrdr": "ok"
  },
  "outcome": "success",
  "build": "git-sha"
}
~~~

Raw query text and filter values are absent. For aggregate zero-result analysis, the system may log a one-way, rotating-salt query hash only after privacy review; it is not part of v1 by default. (Requirement 15)

CloudWatch metrics:

- Calls, errors, and latency by tool.
- Calls, latency, availability, and omissions by Repository/dependency.
- Zero-result and Partial_Result counts.
- Cache hit ratio.
- Application concurrency rejections and WAF blocks.
- ECS task count, CPU, memory, target health, and deployments.

Alarms cover sustained 5xx, no healthy production tasks, high backend failure rate, p95 latency above the SLO, and elevated validation omissions.

## Correctness Properties

Property-based tests run at least 100 generated cases per property. Network and infrastructure behavior are covered by integration and stage tests.

### Property 1: Limits are bounded

For any integer or absent limit, normalization returns a value in 1 through 25, defaults to 10, and preserves valid values.

**Validates: Requirements 1.5, 5.2, 7.5**

### Property 2: Every emitted Solr field is allowlisted

For any valid tool input, every query, filter, facet, sort, return, and related field in the emitted Solr request belongs to the selected RepositoryProfile.

**Validates: Requirements 2.2, 3.2, 10.2**

### Property 3: Immutable public filters are always present

For any search, facet, or related request and any client filters, the emitted Solr request contains the complete Repository-specific public filter set and no client value removes or weakens it.

**Validates: Requirements 2.3, 3.3, 9.1-9.2**

### Property 4: Unsafe query syntax cannot change structure

For any user string, the Solr encoder ensures special characters and local-parameter syntax remain literal values and cannot add clauses, fields, handlers, or filters.

**Validates: Requirement 10.3**

### Property 5: Unknown input fails before I/O

For any request containing an unknown property or unsupported enum, validation rejects the complete request and neither adapter is called.

**Validates: Requirements 1.4, 6.5, 10.4**

### Property 6: Public validation fails closed

For any Candidate set, returned records are exactly the subset confirmed public by the appropriate Canonical_API; failed or timed-out validation never produces a result.

**Validates: Requirements 2.4-2.6, 3.4-3.7, 9.3-9.5**

### Property 7: Non-public and nonexistent records are indistinguishable

For any non-public identifier and nonexistent identifier, <code>get_item</code> and resource reads return the same not-found shape.

**Validates: Requirements 5.4, 9.5**

### Property 8: Normalized output shape is stable

For any supported DSpace or Dataverse canonical payload, summary and full-record normalization emit every required key, use null or empty arrays for absent optional values, and conform to their advertised output schemas.

**Validates: Requirements 4.1-4.7**

### Property 9: Namespaced IDs cannot collide

For any platform identifiers, a JScholarship ID and a JHRDR ID are unequal even when their source strings are equal.

**Validates: Requirement 4.3**

### Property 10: Federation ignores raw score magnitude

For any two repository result lists, multiplying or shifting the raw Solr scores without changing Repository_Rank does not change federated ordering.

**Validates: Requirements 11.1-11.3**

### Property 11: Balanced ties alternate deterministically

For equal Repository_Rank lists, merge order alternates sources according to <code>nextTieSource</code>, and repeated calls with the same cursor and inputs produce the same order.

**Validates: Requirements 11.2, 11.6**

### Property 12: Cursor round-trip and query binding

For any valid cursor payload, encode then decode preserves its values; changing the query, repositories, filters, sort, or limit causes query-hash validation to reject the cursor.

**Validates: Requirements 11.4-11.6**

### Property 13: Partial success preserves successful results

For any two-repository request where exactly one adapter fails, the response contains all qualifying results from the successful adapter, marks the failed repository, and includes no internal error detail.

**Validates: Requirements 1.8, 15.3**

### Property 14: Logs exclude content

For any request and response values, the structured log serializer emits only approved metadata keys and cannot contain raw query, filter values, prompt text, abstracts, tokens, or response bodies.

**Validates: Requirements 15.5-15.6**

### Property 15: Metadata cannot become instructions

For any metadata string containing instruction-like text or markup, normalization treats it as escaped data and prompt generation does not interpolate it into system or developer instructions.

**Validates: Requirements 8.6, 14, 17**

## Testing Strategy

### Unit and Property Tests

- Closed input schemas, bounds, identifier parsers, Solr escaping, and URL construction.
- Repository field mapping and immutable filter construction.
- DSpace and Dataverse payload normalization.
- Federated ranking, tie behavior, cursor codec, and partial-result assembly.
- Log redaction and metadata sanitization.

### Contract Tests

- Recorded, reviewed fixtures from DSpace Solr and REST.
- Recorded, reviewed fixtures from Dataverse Solr and Native API.
- Public, withdrawn, non-discoverable, draft, deaccessioned, and restricted records.
- Schema API fixtures for supported and missing-field startup behavior.
- JSON Schema validation for every tool output.

### Integration Tests

- Real MCP Streamable HTTP initialization and tool/resource/prompt lifecycle.
- Bun-native Web Standard transport behavior, including Host validation and stateless JSON responses.
- Mocked dependency failure, timeout, retry, partial success, and graceful shutdown.
- Local container image health, non-root execution, and confirmation that the final image contains no Node.js runtime.
- Stage VPC DNS and security-group reachability to all four dependencies.

### Discovery Evaluation

A librarian-reviewed benchmark of at least 40 queries covers:

- Exact title and author lookup.
- Handle and DOI lookup.
- Broad topic orientation.
- Foreign-language and metadata-only matches.
- Subject and date refinement.
- Dataset discovery and reusable-data evaluation.
- Related-record discovery within and across repositories.
- Queries expected to return zero results.

Measures include known-item success, precision at 10, reciprocal rank for known items, citation correctness, useful-result time, iteration count, source balance, zero-result rate, and qualitative trust/relevance judgments. (Requirement 16)

### Performance Tests

The pilot load profile is defined before stage evaluation. The initial target is:

- Federated p95 no greater than 3 seconds with healthy dependencies.
- Overall tool deadline no greater than 10 seconds.
- No unbounded canonicalization fan-out.
- Stable behavior with one failed Repository.
- No task memory growth across repeated searches and aborted clients.

## Rollout

### Phase 0: Access and Schema Spike

- Verify exact JScholarship anonymous read filter and archived-item fields.
- Determine whether the JScholarship <code>fulltext</code> field contains only publicly searchable content; keep it disabled unless the public-content proof succeeds.
- Verify exact Dataverse 6.10.1 dataset type and published-version filters.
- Capture approved public/non-public fixtures.
- Validate the four private endpoints and proposed security-group path.
- Decide the private DSpace API endpoint and public MCP hostname.

No production implementation proceeds until both immutable filter sets are demonstrated against known non-public records.

### Phase 1: MCP Core

- Scaffold the strict TypeScript and Bun service, Hono HTTP layer, Web Standard MCP transport, and static MCP registry.
- Implement normalized models, validation, query builder, cursor, and error types.
- Implement both adapters against fixtures.
- Implement search and get-item tools.

### Phase 2: Stage Integration

- Deploy one task, ALB/WAF, and cross-stack security rules.
- Validate live schemas and canonical API behavior.
- Add facets, related records, resources, prompts, caching, and telemetry.
- Complete MCP compatibility and failure tests.

### Phase 3: Evaluation and Hardening

- Run security fixtures and load tests.
- Execute benchmark searches with librarians.
- Tune field boosts and normalization without changing public filters.
- Conduct the researcher/librarian pilot and collect privacy-safe measures.

### Phase 4: Production

- Obtain owner sign-off.
- Promote the exact tested image digest.
- Deploy two tasks with autoscaling, dashboards, alarms, and runbook.
- Run post-deployment access, compatibility, and citation smoke tests.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Direct Solr bypasses platform permissions | Immutable backend filters plus mandatory Canonical_API validation for every returned record |
| Dataverse metadata fields change with metadata blocks | Versioned field manifest, startup schema validation, and fail readiness on missing system fields |
| DSpace and Dataverse scores are incomparable | Repository-local rank plus balanced reciprocal-rank merge |
| Canonicalization produces many API calls | Bounded over-fetch, worker pools, short-lived public caches, and a 10-second deadline |
| One repository outage breaks discovery | Concurrent adapters and explicit Partial_Result behavior |
| Full-text indexes contain restricted text | Keep full-text query fields disabled unless Phase 0 proves all indexed values are publicly searchable; never return full text as a value, snippet, or resource |
| An MCP SDK dependency behaves differently on Bun | Use the SDK's Web Standard transport, pin Bun and SDK versions, and run protocol plus graceful-shutdown tests against the production image |
| Public endpoint is abused | WAF rate limits, request bounds, concurrency semaphore, and backend timeouts |
| Research queries create privacy concerns | No raw query/filter/prompt logging and no user identity collection |
| Metadata contains prompt injection | Treat metadata as untrusted data, sanitize markup, and keep it out of instruction roles |
| Dedicated ALB adds cost | Accept for independent ownership and security isolation; reassess after pilot usage |

## Open Decisions

The following decisions must be completed during Phase 0 and recorded in an ADR or spec update:

1. Public production hostname and whether Cloudflare proxies it or provides DNS only.
2. Exact private DSpace REST route used by the MCP.
3. Exact deployed public-filter fields and values for DSpace and Dataverse.
4. Approved browser Origin allowlist for HopGPT and other target hosts.
5. Pilot WAF rate and application concurrency limits.
6. Production SLO and load profile after stage measurements.
