# JHRDR (Dataverse 6.10.1) Schema and Access Spike

**Task:** 1.2 — Verify the deployed Dataverse 6.10.1 Solr fields for record type, publication status, version state, persistent identifiers, and citation metadata.

**Status:** Configuration-verified. Live verification pending stage access.

**Requirements:** 3.1-3.4, 9.1-9.7, 16.1

---

## 1. Field Manifest

Extracted from `jhu-dataverse-deployment/config/solr/schema.xml` for Dataverse 6.10.1, collection `collection1`.

### System Identity Fields

| Field | Type | Required | MultiValued | Purpose |
| --- | --- | --- | --- | --- |
| `id` | string | Yes | No | Solr document unique key (e.g. `dataset_42_draft` or `dataset_42`) |
| `entityId` | plong | Yes | No | Dataverse database entity ID (primary key) |
| `dvObjectType` | string | Yes | No | Entity type: `Dataverse`, `Dataset`, or `DataFile` |
| `publicationStatus` | string | No | Yes | Publication lifecycle states: `Published`, `Draft`, `Deaccessioned` |
| `identifier` | string | No | No | Persistent identifier string (e.g. `doi:10.7281/T1/EXAMPLE`) |
| `persistentUrl` | string | No | No | Full persistent URL (e.g. `https://doi.org/10.7281/T1/EXAMPLE`) |
| `dateSort` | pdate | No | No | Sort-optimized date field |
| `nameSort` | string | No | No | Sort-optimized name field (lowercase title) |

### Public-Access Gate Fields

| Field | Type | Values | MCP Filter |
| --- | --- | --- | --- |
| `dvObjectType` | string | `Dataverse`, `Dataset`, `DataFile` | `fq=dvObjectType:Dataset` |
| `publicationStatus` | string (multiValued) | `Published`, `Draft`, `Deaccessioned` | `fq=publicationStatus:Published` AND `fq=-publicationStatus:Deaccessioned` |
| `discoverableBy` | string (multiValued) | Group aliases with discovery permission | TODO: `fq=discoverableBy:Anonymous` (verify exact value) |

### Citation Metadata Fields

| Field | Type | MultiValued | Purpose |
| --- | --- | --- | --- |
| `title` | text_en | No | Dataset title from citation metadata block |
| `authorName` | text_en | Yes | Author names |
| `authorAffiliation` | text_en | Yes | Author institutional affiliations |
| `authorIdentifier` | text_en | Yes | Author identifiers (e.g. ORCID) |
| `dsDescriptionValue` | text_en | Yes | Dataset description text (abstract equivalent) |
| `subject` | text_en | Yes | Subject terms (text_en for search) |
| `dvSubject` | string | Yes | Dataverse-level subject facets (exact-match for faceting) |
| `keywordValue` | text_en | Yes | Keywords from citation metadata block |
| `topicClassValue` | text_en | Yes | Topic classifications |
| `license` | string | No | License identifier (e.g. `CC0 1.0`, `CC BY 4.0`) |
| `fileCount` | plong | No | Number of files in the dataset |
| `citation` | string | No | Formatted dataset citation string (stored, not indexed) |
| `publicationDate` | string | No | Dataset publication date string |

### Hierarchy Fields

| Field | Type | MultiValued | Purpose |
| --- | --- | --- | --- |
| `parentId` | string | No | Parent Dataverse entity ID |
| `parentIdentifier` | string | No | Parent Dataverse alias (collection filtering) |
| `parentName` | string | No | Parent Dataverse display name |
| `subtreePaths` | string | Yes | Hierarchy tree paths for collection tree |

### Required vs Optional Classification

**Required fields** (fail readiness if absent from schema):

| Field | Reason |
| --- | --- |
| `id` | Document primary key |
| `entityId` | Database entity reference |
| `dvObjectType` | Record-type filtering |
| `publicationStatus` | Publication lifecycle gate |
| `identifier` | Persistent identifier for canonical lookup |
| `persistentUrl` | Citation URL |
| `dateSort` | Deterministic sort |
| `nameSort` | Deterministic sort |

**Optional fields** (degraded service if missing):

| Field | Degradation |
| --- | --- |
| `title` | No title in search results |
| `authorName` | No creator metadata |
| `authorAffiliation` | No affiliation metadata |
| `authorIdentifier` | No ORCID linking |
| `dsDescriptionValue` | No abstract/description |
| `subject` | No subject search |
| `dvSubject` | No subject faceting |
| `keywordValue` | No keyword search |
| `topicClassValue` | No topic classification |
| `license` | No license display |
| `fileCount` | No file count |
| `citation` | No formatted citation |
| `parentId` | No hierarchy navigation |
| `parentIdentifier` | No collection filtering |
| `parentName` | No collection display name |
| `publicationDate` | No publication date |

---

## 2. Immutable Public Filter Set

The JHRDR adapter appends these filter queries (`fq`) to **every** Solr request (search, facet, related). They cannot be removed, weakened, or overridden by any client input.

```
fq=dvObjectType:Dataset
fq=publicationStatus:Published
fq=-publicationStatus:Deaccessioned
```

### Potential Additional Filter (TODO: verify live)

```
fq=discoverableBy:Anonymous
```

The `discoverableBy` field may require a filter for anonymous/public access. The exact group alias value (e.g., `Anonymous`, `Public`, or `:guest`) needs live verification against the stage Dataverse deployment.

### Derivation

Dataverse indexes all entity types (Dataverse collections, Datasets, DataFiles) into a single `collection1`. The MCP needs only publicly published datasets:

1. `dvObjectType:Dataset` — excludes collection-level metadata documents and file-level documents.
2. `publicationStatus:Published` — ensures the dataset has at least one publicly released version.
3. `-publicationStatus:Deaccessioned` — excludes datasets that have been removed from public access, even if they also carry a `Published` status value.

### Records Excluded

| Filter Condition | What It Excludes | Why |
| --- | --- | --- |
| `dvObjectType:Dataverse` | Collection metadata | Not a dataset — administrative collection record |
| `dvObjectType:DataFile` | File-level documents | Individual file metadata, not a dataset |
| `publicationStatus:Draft` only | Unpublished dataset | Never been publicly released |
| `publicationStatus:Deaccessioned` | Removed dataset | Retracted or removed from public access |
| No `publicationStatus:Published` | Never-released dataset | Has no published version |
| Missing `discoverableBy:Anonymous` | Access-restricted dataset | Not discoverable by anonymous users (pending verification) |

### The "Published + Newer Draft" Scenario

Dataverse indexes the **latest version** of a dataset. When a dataset has a published version and a newer draft update, the Solr document shows:

```json
"publicationStatus": ["Published", "Draft"]
```

The `publicationStatus:Published` filter **includes** this document (correct behavior — the published version exists and is publicly accessible). When the MCP resolves this candidate through the Dataverse Native API, it requests the **latest published version** (`?version=:latest-published`), effectively ignoring the unpublished draft.

This is the correct behavior: the public user can access the most recent published version, and the existence of a newer draft does not affect public access to the published version.

---

## 3. Dataverse REST Route

### Application Endpoint

| Property | Value |
| --- | --- |
| Cloud Map DNS | `dataverse.dataverse-stage.internal` |
| Port | 8080 |
| Protocol | HTTP (internal, no TLS) |
| Health endpoint | `/api/info/version` |
| Expected response | JSON with version number (e.g. `{"status":"OK","data":{"version":"6.10.1","build":"..."}}`) |
| Security group | `sg-0a08a43d3e2769417` (jhu-stage-dataverse-app-sg) |
| Ingress port | 8080/tcp |

### Key Native API Endpoints for MCP

| Operation | Method | Path |
| --- | --- | --- |
| Dataset metadata (latest published) | GET | `/api/datasets/:persistentId/?persistentId={pid}&version=:latest-published` |
| Dataset metadata (by ID) | GET | `/api/datasets/{id}?version=:latest-published` |
| Dataset files | GET | `/api/datasets/:persistentId/versions/:latest-published/files?persistentId={pid}` |
| Version info | GET | `/api/info/version` |

### Routing Notes

- **No internal ALB** — direct Cloud Map service discovery routing (unlike JScholarship which uses an internal ALB).
- Dataverse runs on Payara/Glassfish at port 8080 within the ECS task.
- No authentication required for public dataset metadata retrieval via the Native API.

---

## 4. Solr Route

| Property | Value |
| --- | --- |
| Cloud Map DNS | `solr.dataverse-stage.internal` |
| Port | 8983 |
| Protocol | HTTP (internal, no TLS) |
| Collection | `collection1` |
| Select URL | `http://solr.dataverse-stage.internal:8983/solr/collection1/select` |
| Schema URL | `http://solr.dataverse-stage.internal:8983/solr/collection1/schema/fields` |
| Health endpoint | `/solr/collection1/admin/ping` |
| Security group | `sg-05cc4195182af07c1` (jhu-stage-dataverse-solr-sg) |
| Ingress port | 8983/tcp |

### Solr Configuration

- Single-node Solr (not SolrCloud) — Dataverse ships a single Solr instance, not a cluster.
- Collection name is always `collection1` (Dataverse convention).
- No ZooKeeper dependency (unlike DSpace SolrCloud with its 3-node ZK ensemble).

---

## 5. Key Differences from JScholarship

| Aspect | JScholarship (DSpace) | JHRDR (Dataverse) |
| --- | --- | --- |
| Platform | DSpace 7.x | Dataverse 6.10.1 |
| Solr topology | SolrCloud (3-node + ZooKeeper) | Single Solr instance |
| Collection name | `search` | `collection1` |
| Field naming | Discovery-generated dynamic patterns (`*_filter`, `*_keyword`, `*_mlt`) | Direct explicit field names (`title`, `authorName`, `subject`) |
| Access control field | `read` (multiValued group IDs, `g0` = anonymous) | `discoverableBy` (multiValued group aliases, value TBD) |
| Item state management | `withdrawn`, `discoverable`, `latestVersion`, `database_status` (4 separate fields) | `publicationStatus` (single multiValued field with lifecycle states) |
| Publication filter | `database_status:ARCHIVED` | `publicationStatus:Published` |
| Withdrawal filter | `-withdrawn:true` | `-publicationStatus:Deaccessioned` |
| Draft filter | `database_status` excludes WORKFLOW/WORKSPACE | `publicationStatus:Published` excludes Draft-only records |
| Version management | `latestVersion:true` field | Solr indexes latest version; API resolves `:latest-published` |
| Text analysis | Custom `text` type (ICU folding, no stemming) | `text_en` (English stemming + ASCII folding + stop words) |
| MoreLikeThis | Dedicated `*_mlt` fields with termVectors | No MoreLikeThis config; related search uses manual query construction |
| Persistent ID type | Handle (`1774.2/xxxxx`) | DOI (`doi:10.7281/T1/XXXXX`) or Handle |
| Canonical API | DSpace REST (HAL+JSON) | Dataverse Native API (JSON) |
| API routing | Internal ALB → target group → container:8080 | Direct Cloud Map → container:8080 |
| Object type filter | `search.resourcetype:Item` | `dvObjectType:Dataset` |
| Faceting fields | Dynamic `*_filter` pattern (keywordFilter type) | Direct string fields (`dvSubject`, `license`) |
| Sort fields | Dynamic `*_sort` pattern (lowerCaseSort type) | Dedicated `dateSort` (pdate) and `nameSort` (string) |

---

## 6. Field Type Analysis

### `text_en` (Dataverse primary analysis)

```
StandardTokenizer
  → StopFilterFactory (English)
  → LowerCaseFilterFactory
  → EnglishPossessiveFilterFactory
  → KeywordRepeatFilterFactory
  → PorterStemFilterFactory
  → RemoveDuplicatesTokenFilterFactory
  → ASCIIFoldingFilterFactory
```

**Implications for MCP:**
- English stemming means `"computing"` matches `"compute"`, `"computed"`, etc.
- Stop words are removed — common English words like "the", "is", "of" are not indexed.
- ASCII folding means `"café"` matches `"cafe"`.
- Possessive handling means `"Smith's"` matches `"Smith"`.

### `text_general` (catchall `_text_` field)

```
StandardTokenizer
  → StopFilterFactory
  → LowerCaseFilterFactory
```

Simpler analysis without stemming, used for the broad `_text_` catchall.

### `string` (exact-match faceting)

No analysis — used for `dvSubject`, `license`, `publicationStatus`, `dvObjectType`. Exact-match required for facet queries.

---

## 7. Remaining Live-Verification Steps

These require connectivity to the stage environment's private subnets:

### 7.1 Confirm `discoverableBy` Anonymous Value
```bash
# Query a known public dataset to find the anonymous group alias:
curl "http://solr.dataverse-stage.internal:8983/solr/collection1/select?q=*:*&fq=dvObjectType:Dataset&fq=publicationStatus:Published&rows=1&fl=id,identifier,discoverableBy"
```
Determine: What value appears in `discoverableBy` for public datasets? Is it `Anonymous`, `:guest`, `public`, or something else? Does the field exist on all public documents?

### 7.2 Verify "Published + Newer Draft" Scenario
```bash
# Find a dataset with both Published and Draft status:
curl "http://solr.dataverse-stage.internal:8983/solr/collection1/select?q=*:*&fq=dvObjectType:Dataset&fq=publicationStatus:Published&fq=publicationStatus:Draft&rows=1&fl=id,identifier,publicationStatus"
```
Confirm: The document has `publicationStatus:["Published","Draft"]` and is included by the `publicationStatus:Published` filter.

### 7.3 Confirm Dataverse Native API Health
```bash
curl http://dataverse.dataverse-stage.internal:8080/api/info/version
```
Expected: `{"status":"OK","data":{"version":"6.10.1","build":"..."}}` or similar JSON response with the version number.

### 7.4 Test Connectivity from Private Subnets
```bash
# From a task in the shared private subnets:

# Solr connectivity:
curl -s -o /dev/null -w "%{http_code}" http://solr.dataverse-stage.internal:8983/solr/collection1/admin/ping

# App connectivity:
curl -s -o /dev/null -w "%{http_code}" http://dataverse.dataverse-stage.internal:8080/api/info/version
```
Expected: Both return HTTP 200 from the shared private subnets.

### 7.5 Schema API Verification
```bash
curl "http://solr.dataverse-stage.internal:8983/solr/collection1/schema/fields"
```
Confirm all required fields from the field manifest are present in the live schema.

### 7.6 Public Dataset Retrieval via Native API
```bash
# Resolve a known public dataset by persistent ID:
curl "http://dataverse.dataverse-stage.internal:8080/api/datasets/:persistentId/?persistentId=doi:10.7281/T1/KNOWN_PUBLIC&version=:latest-published"
```
Confirm: Returns 200 with dataset metadata for a public dataset without authentication.

### 7.7 Non-Public Dataset Exclusion
```bash
# Confirm deaccessioned dataset is excluded by immutable filters:
curl "http://solr.dataverse-stage.internal:8983/solr/collection1/select?q=*:*&fq=dvObjectType:Dataset&fq=publicationStatus:Published&fq=-publicationStatus:Deaccessioned&rows=0"
# Note the numFound count

# Compare without the deaccessioned exclusion:
curl "http://solr.dataverse-stage.internal:8983/solr/collection1/select?q=*:*&fq=dvObjectType:Dataset&fq=publicationStatus:Published&rows=0"
# If numFound is higher, deaccessioned datasets exist and are being correctly excluded
```

---

## 8. Decision Summary

| Decision | Value | Confidence | Verification |
| --- | --- | --- | --- |
| Object type filter | `dvObjectType:Dataset` | Definitive (schema) | N/A |
| Publication filter | `publicationStatus:Published` | High (Dataverse convention) | Needs live confirmation |
| Deaccessioned exclusion | `-publicationStatus:Deaccessioned` | High (Dataverse convention) | Needs live confirmation |
| Anonymous discovery field | `discoverableBy` (value TBD) | Medium (field exists in schema) | Needs live verification of exact value |
| Required schema fields | 8 fields | High (schema.xml) | Needs Schema API check |
| Optional metadata fields | 16 fields | High (schema.xml) | Needs Schema API check |
| Solr route | `solr.dataverse-stage.internal:8983` | Confirmed (Cloud Map) | Needs connectivity test |
| App route | `dataverse.dataverse-stage.internal:8080` | Confirmed (Cloud Map) | Needs connectivity test |
| Solr topology | Single instance (not SolrCloud) | High (Dataverse architecture) | N/A |
| Collection name | `collection1` | Definitive (Dataverse convention) | N/A |
| Text analysis | `text_en` with English stemming | Definitive (schema.xml) | N/A |
| No MoreLikeThis config | Manual query construction for related | High (no MLT fields in schema) | N/A |
| No internal ALB | Direct Cloud Map routing | Confirmed (infrastructure) | Needs connectivity test |
| Published + Draft handling | Filter includes; API resolves `:latest-published` | High (Dataverse semantics) | Needs live scenario test |

---

## 9. Artifacts Produced

| Artifact | Path | Purpose |
| --- | --- | --- |
| Solr schema fixture | `test/fixtures/jhrdr/solr-schema.json` | Contract test input with full field documentation |
| Fixture README | `test/fixtures/jhrdr/README.md` | Fixture documentation and planned fixtures |
| Endpoint config | `config/repositories/jhrdr-endpoints.ts` | Network endpoints and security groups (stub) |
| This document | `docs/spike/jhrdr-schema-spike.md` | Complete spike record |
