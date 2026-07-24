# JScholarship Schema and Access Spike

**Task:** 1.1 — Verify the deployed JScholarship Solr fields, anonymous-group read value, archived-item state, and immutable public filter against known public and non-public records.

**Status:** Configuration-verified. Live verification pending stage access.

**Requirements:** 2.1, 2.3, 9.1-9.8, 16.1

---

## 1. Field Manifest

### System Identity Fields

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `search.resourceid` | string | Yes | DSpace UUID |
| `search.resourcetype` | string | Yes | Item / Collection / Community |
| `search.uniqueid` | string | Yes | Solr document primary key |
| `handle` | string (docValues) | No | Persistent Handle identifier |

### Public-Access Gate Fields

| Field | Type | Values | MCP Filter |
| --- | --- | --- | --- |
| `withdrawn` | string (docValues) | "true" / "false" | `-withdrawn:true` |
| `discoverable` | string (docValues) | "true" / "false" | `-discoverable:false` |
| `latestVersion` | boolean (default: true) | true / false | `latestVersion:true` |
| `database_status` | string (docValues) | ARCHIVED / WORKFLOW / WORKSPACE | `database_status:ARCHIVED` |
| `read` | string (multiValued, docValues) | Group IDs (e.g., "g0") | `read:g0` |

### Hierarchy Fields

| Field | Type | Purpose |
| --- | --- | --- |
| `location.comm` | lowerCaseSort (multiValued) | Community UUIDs |
| `location.coll` | lowerCaseSort (multiValued) | Collection UUIDs |

### Discovery-Generated Fields (Dynamic Patterns)

| Pattern | Type | Generated From | Used For |
| --- | --- | --- | --- |
| `*_filter` | keywordFilter | Search filter beans | Faceting, sidebar filters |
| `*_keyword` | keywordFilter | Keyword-indexed metadata | Exact matching |
| `*_partial` | text (analyzed) | Browse/search metadata | Tokenized search |
| `*_hl` | text | Search metadata | Hit highlighting |
| `*_sort` | lowerCaseSort | Sort configuration | Deterministic ordering |
| `*_mlt` | text (termVectors) | MoreLikeThis config | Related-record discovery |
| `*.year` | sint | Date fields | Year facets |
| `*_dt` | date | Date fields | Date sort/range |

### Known Generated Field Names

| Field | Source Metadata | Purpose |
| --- | --- | --- |
| `title` (search field) | dc.title | Title search |
| `author` (search field) | dc.contributor.author, dc.contributor.other, dc.creator | Author/creator search |
| `subject` (search field) | dc.subject.* | Subject search |
| `subject_filter` | dc.subject | Subject facet |
| `author_filter` | dc.contributor.author | Author facet |
| `dateIssued_filter` | dc.date.issued | Date filter |
| `dateIssued.year` | dc.date.issued | Year facet |
| `itemtype_filter` | dc.type | Resource type facet |
| `entityType_filter` | dspace.entity.type | Entity type facet |
| `dc.title_sort` | dc.title | Title sort |
| `dc.date.issued_dt` | dc.date.issued | Date sort |
| `dc.date.accessioned_dt` | dc.date.accessioned | Accession date sort |
| `dc.title_mlt` | dc.title | MoreLikeThis |
| `dc.contributor.author_mlt` | dc.contributor.author | MoreLikeThis |
| `dc.creator_mlt` | dc.creator | MoreLikeThis |
| `dc.subject_mlt` | dc.subject | MoreLikeThis |

---

## 2. Immutable Public Filter Set

The MCP appends these filter queries (`fq`) to **every** Solr request (search, facet, related). They cannot be removed, weakened, or overridden by any client input.

```
fq=search.resourcetype:Item
fq=latestVersion:true
fq=-withdrawn:true
fq=-discoverable:false
fq=database_status:ARCHIVED
fq=read:g0
```

### Derivation

DSpace Discovery's default filter queries for public UI:
```
(search.resourcetype:Item AND latestVersion:true) OR search.resourcetype:Collection OR search.resourcetype:Community
-withdrawn:true AND -discoverable:false
```

For the MCP (Items only), we:
1. Remove Collection/Community alternatives (MCP only returns Items)
2. Add explicit `database_status:ARCHIVED` (Discovery relies on the UI not indexing non-archived items, but Solr contains them)
3. Add explicit `read:g0` (ensures only anonymously-readable items are returned)

### Records Excluded

| Condition | Why Excluded |
| --- | --- |
| `withdrawn:true` | Withdrawn by administrator, no longer publicly available |
| `discoverable:false` | Hidden from all search/browse interfaces |
| `latestVersion:false` | Superseded by a newer version |
| `database_status:WORKFLOW` | In approval workflow, not yet published |
| `database_status:WORKSPACE` | Being drafted by submitter |
| `read` without `g0` | Restricted to specific authenticated groups |

---

## 3. Anonymous Group Value

**Value:** `g0`

**Source:** DSpace convention — the Anonymous group is always group ID 0, stored in Solr as the string "g0". The `read` field is multiValued; items readable by anonymous users have "g0" among their group IDs.

**Verification needed:** Query a known public item in stage and confirm `read` contains `g0`.

---

## 4. Archived Item State

**Value:** `ARCHIVED`

**Source:** DSpace `database_status` field. Valid states:
- `ARCHIVED` — Item is in the live public archive
- `WORKFLOW` — Item is in approval workflow
- `WORKSPACE` — Item is being drafted

Only `ARCHIVED` items should appear in public search results.

**Verification needed:** Query a known public item and confirm `database_status:ARCHIVED`. Query a known workflow item and confirm the filter excludes it.

---

## 5. Fulltext Decision

**Decision:** DISABLED. The `fulltext` field is NOT included in any allowlist.

### Evidence

1. **DSpace discovery.xml comment:**
   > "full text snippets are disabled, as snippets of embargoed/restricted bitstreams may appear in search results when the Item is public. See DS-3498"

2. **Schema analysis:** The `fulltext` field (type: text, multiValued, stored) contains indexed content from ALL bitstream bundles, including ORIGINAL, TEXT, and potentially LICENSE bundles. When an Item is public but has restricted bitstreams, the fulltext field still contains content from those restricted files.

3. **Risk assessment:**
   - **Matching:** A query matching fulltext could confirm that a restricted document contains specific text.
   - **Ranking:** Documents ranked higher due to fulltext matches could implicitly reveal restricted content.
   - **Facets:** If fulltext were facetable (it isn't currently), it could expose restricted terms.
   - **Highlighting:** Already disabled by DSpace team for this exact reason.
   - **Explanations:** The `explain_search` tool could theoretically reference fulltext matches.

### Conditions for Re-enablement

The fulltext field may be added to the keyword query allowlist (for ranking only, never returned) IF and ONLY IF Phase 0 demonstrates:

1. Every value in the fulltext field for items matching the immutable public filter is derived exclusively from publicly accessible bitstreams.
2. No restricted, embargoed, or non-public bitstream content appears in the fulltext field of any publicly-filtered item.
3. The matching and ranking signals cannot be used to infer the content of restricted documents.

This proof would require examining the DSpace indexing pipeline to confirm that bitstream-level access control is respected during fulltext extraction, which is known NOT to be the case per DS-3498.

---

## 6. DSpace REST Route

**Stage:** Internal ALB at `internal-private-dspace-stage-alb-1049626423.us-east-1.elb.amazonaws.com` port 80

**Routing:**
- Port 80 listener → `private-dspace-stage-api-tg` target group → DSpace container port 8080
- Health check: `GET /server/api` (returns 200 with HAL response)

**Alternative:** If Cloud Map is configured for the API container, it may be reachable at `api.dspace-stage.local`. The internal ALB provides load balancing and health checking.

**Key REST endpoints for MCP:**
- `GET /server/api/core/items/{uuid}` — Item by UUID
- `GET /server/api/pid/find?id={handle}` — Item by Handle
- `GET /server/api/core/items/{uuid}/bundles` — Bitstream bundles
- `GET /server/api/core/bitstreams/{uuid}` — Bitstream metadata (not content)

---

## 7. Security Group Requirements

The MCP task security group needs:

| Target | Port | Protocol | Security Group |
| --- | --- | --- | --- |
| DSpace Solr | 8983 | TCP | `sg-0b6c16eeac34e071d` (dspace-stage-solr-sg) |
| DSpace REST (via ALB) | 80 | TCP | `sg-0e22b5c256c6efb60` (private-dspace-stage-alb-sg) |

The MCP infrastructure stack must create ingress rules on these security groups allowing traffic from the MCP task security group. The rules are owned by the MCP stack (using exported SG IDs from the DSpace stack) to avoid circular dependencies.

---

## 8. Remaining Live-Verification Steps

These require ECS exec access to the stage environment or direct queries to the internal endpoints:

### 8.1 Solr Schema API Verification
```bash
# Via ecs-exec into a Solr container, or through a task in the private subnet:
curl http://solr.dspace-stage.local:8983/solr/search/schema/fields
```
Confirm all required fields from `requiredSchemaFields` are present.

### 8.2 Public Item Verification
```bash
# Query a known public item by handle:
curl "http://solr.dspace-stage.local:8983/solr/search/select?q=handle:1774.2/KNOWN_PUBLIC_HANDLE&fl=search.resourceid,withdrawn,discoverable,latestVersion,database_status,read"
```
Expected: `withdrawn:false`, `discoverable:true`, `latestVersion:true`, `database_status:ARCHIVED`, `read` contains `g0`.

### 8.3 Non-Public Item Exclusion
```bash
# Query without public filters to find withdrawn items:
curl "http://solr.dspace-stage.local:8983/solr/search/select?q=withdrawn:true&rows=1&fl=search.resourceid,handle,withdrawn,read"

# Apply public filters and confirm zero results:
curl "http://solr.dspace-stage.local:8983/solr/search/select?q=*:*&fq=search.resourcetype:Item&fq=latestVersion:true&fq=-withdrawn:true&fq=-discoverable:false&fq=database_status:ARCHIVED&fq=read:g0&fq=handle:WITHDRAWN_HANDLE&rows=1"
```
Expected: Zero results for any withdrawn, non-discoverable, or restricted item.

### 8.4 DSpace REST Accessibility
```bash
curl http://internal-private-dspace-stage-alb-1049626423.us-east-1.elb.amazonaws.com/server/api/core/items/KNOWN_UUID
```
Confirm: Returns 200 with item metadata for a public item; returns 401/403/404 for non-public items.

### 8.5 Anonymous Access Confirmation
```bash
# Confirm that DSpace REST returns item data WITHOUT authentication:
curl -H "Accept: application/json" http://internal-private-dspace-stage-alb-1049626423.us-east-1.elb.amazonaws.com/server/api/core/items/PUBLIC_UUID
# Should return 200 with full metadata

curl -H "Accept: application/json" http://internal-private-dspace-stage-alb-1049626423.us-east-1.elb.amazonaws.com/server/api/core/items/RESTRICTED_UUID
# Should return 401 or the response should lack restricted bundle data
```

---

## 9. Decision Summary

| Decision | Value | Confidence | Verification |
| --- | --- | --- | --- |
| Anonymous group in `read` field | `g0` | High (DSpace convention) | Needs live confirmation |
| Archived state value | `ARCHIVED` | High (DSpace convention) | Needs live confirmation |
| Immutable filter set | 6 `fq` clauses | High (derived from discovery.xml) | Needs non-public record test |
| Fulltext enabled | No | Definitive (DS-3498) | No further proof needed |
| Solr route | `solr.dspace-stage.local:8983` | Confirmed (Cloud Map + ALB) | Needs connectivity test |
| REST route | Internal ALB port 80 | Confirmed (AWS infra) | Needs connectivity test |
| Required schema fields | 11 fields | High (schema.xml) | Needs Schema API check |

---

## 10. Artifacts Produced

| Artifact | Path | Purpose |
| --- | --- | --- |
| RepositoryProfile | `config/repositories/jscholarship-profile.ts` | Field manifest and filter configuration |
| Endpoint config | `config/repositories/jscholarship-endpoints.ts` | Network endpoints and security groups |
| Schema fixture | `test/fixtures/jscholarship/solr-schema.json` | Contract test input |
| Profile test | `test/spike/jscholarship-profile.test.ts` | Acceptance criteria as executable assertions |
| This document | `docs/spike/jscholarship-schema-spike.md` | Complete spike record |
