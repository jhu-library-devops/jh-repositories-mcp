# JScholarship Test Fixtures

## Purpose

These fixtures document the deployed JScholarship (DSpace) Solr schema fields, access-control semantics, and Discovery configuration. They serve as the ground truth for:

1. **Profile validation** — Confirming that every field in the JScholarship RepositoryProfile exists in the deployed schema.
2. **Immutable filter coverage** — Proving that the public filter set excludes all non-public record states.
3. **Fulltext exclusion** — Documenting why fulltext is disabled and the evidence supporting that decision.
4. **Contract testing** — Providing stable inputs for adapter and query-builder tests without network calls.

## Fixtures

### `solr-public-item.json`

A single synthetic Solr document representing a known public JScholarship item. Contains all fields the MCP will use:

| Field Category | Fields Included |
| --- | --- |
| Identity | `search.resourceid`, `search.resourcetype`, `search.uniqueid`, `handle` |
| Public-access gate | `withdrawn:false`, `discoverable:true`, `latestVersion:true`, `database_status:ARCHIVED`, `read` containing `g0` |
| Hierarchy | `location.comm`, `location.coll` |
| Metadata (Discovery-generated) | `title`, `author`, `subject`, `dateIssued`, `itemtype` |
| Filter fields | `*_filter` variants for all configured facets |
| Sort fields | `dc.title_sort`, `dc.date.issued_dt`, `dc.date.accessioned_dt` |
| MoreLikeThis fields | `dc.title_mlt`, `dc.contributor.author_mlt`, `dc.subject_mlt` |
| Year facet | `dateIssued.year` |

Used for positive testing: this document passes all immutable public filters and should be returned by the MCP.

### `solr-withdrawn-item.json`

A single synthetic Solr document for a **withdrawn** JScholarship item (`withdrawn:true`). The immutable filter `-withdrawn:true` must exclude this document from all search, facet, and related-record queries. Used for negative testing.

### `solr-restricted-item.json`

A single synthetic Solr document for a **restricted** JScholarship item. The `read` field contains only specific group IDs (`g5`, `g12`) and does NOT contain `g0` (anonymous group). The immutable filter `read:g0` must exclude this document. Used for negative testing of the anonymous-access filter.

### `solr-search-response.json`

A synthetic Solr search response in the standard DSpace format with:

| Section | Content |
| --- | --- |
| `responseHeader` | Status, timing, and query parameters showing the immutable `fq` clauses |
| `response.docs` | Two public items that pass all filters (positive test cases) |
| `facet_counts` | Realistic facet field values with counts for `subject_filter`, `author_filter`, and `dateIssued.year` |
| `_excluded_for_negative_testing` | A withdrawn item document included as reference data for negative tests — it must never appear in actual query results |

### `dspace-rest-item.json`

A synthetic DSpace 7 REST API response for a public item in HAL+JSON format. Corresponds to `solr-public-item.json` (same UUID/handle). Contains:

- Full Dublin Core metadata: `dc.title`, `dc.contributor.author`, `dc.subject`, `dc.date.issued`, `dc.type`, `dc.description.abstract`, `dc.identifier.uri`, `dc.publisher`, `dc.rights`
- Item state fields: `inArchive:true`, `discoverable:true`, `withdrawn:false`
- HAL `_links`: `bundles`, `owningCollection`, `thumbnail`, `self`
- Entity type, handle, and UUID

### `dspace-rest-bundles.json`

A synthetic DSpace 7 REST bundles response for a public item showing:

- **ORIGINAL bundle** with 2 public bitstreams:
  - A PDF article (2.4 MB) with format metadata
  - A PNG figure image (845 KB) with format metadata
- **THUMBNAIL bundle** with 1 generated thumbnail JPEG

Each bitstream includes `id`, `name`, `sizeBytes`, `checkSum`, format information (`mimetype`, `shortDescription`), and HAL `_links` (content, format, self).

### `dspace-rest-not-found.json`

A synthetic DSpace 7 REST API 404 response. DSpace returns this same shape whether the item does not exist or the caller lacks access. The MCP must return indistinguishable `not_found` responses for both cases (Requirement 9.5).

### `solr-schema.json`

A sanitized representation of the JScholarship Solr `search` collection schema, extracted from:

- **Schema source:** `jhu-dspace-deployment/config/solr/configsets/search/schema.xml`
- **Discovery source:** `jhu-dspace-deployment/config/dspace/spring/api/discovery.xml`
- **Captured:** 2025-01-15

Contains:

| Section | What it proves |
| --- | --- |
| `explicitFields` | Every required and optional field referenced by the RepositoryProfile exists with the expected type, storage, and multiValue configuration |
| `dynamicFieldPatterns` | Discovery-generated fields (`*_filter`, `*_mlt`, `*_sort`, `*_dt`) are available via pattern matching |
| `fieldTypes` | The text analysis chain (ICU folding, stemming, WordDelimiter) that determines search behavior |
| `copyFields` | The `*` → `search_text` catchall that powers broad keyword search |
| `discoveryConfiguration` | The exact filter queries, search filters, sort options, and MoreLikeThis settings deployed |
| `publicFilterExplanation` | Documents each immutable filter condition and the record states it excludes |

### What Was Removed

- No raw Solr admin API responses (which could contain version/host info)
- No actual document content or metadata values
- No credentials, tokens, or authentication headers
- No private IP addresses (security group IDs are infrastructure-as-code references, not network addresses)
- No internal hostnames beyond what's documented in the public deployment repository

## How It Was Captured

1. Reviewed `schema.xml` from `jhu-dspace-deployment/config/solr/configsets/search/` for explicit field definitions, dynamic patterns, field types, and copy fields.
2. Reviewed `discovery.xml` from `jhu-dspace-deployment/config/dspace/spring/api/` for search filter beans, sort options, MoreLikeThis configuration, and default filter queries.
3. Extracted only the field names, types, and configuration relevant to the MCP adapter.
4. Documented the full-text disablement rationale from the inline comment referencing DS-3498.
5. Recorded the anonymous-group value (`g0`) and archived-item state (`ARCHIVED`) from DSpace source code conventions.

## Remaining Live-Verification Steps

These cannot be completed from configuration files alone and require stage environment access:

1. **Confirm `g0` is the deployed anonymous group value** — Query Solr for a known public item and verify `read` contains `g0`.
2. **Confirm `ARCHIVED` is the live archive state** — Query for a known public item and verify `database_status:ARCHIVED`.
3. **Verify exclusion of non-public records** — Query for known withdrawn, non-discoverable, workflow, and restricted items and confirm they are filtered out.
4. **Validate field existence via Schema API** — Call `/solr/search/schema/fields` to confirm required fields are present in the running Solr instance.
5. **Test DSpace REST accessibility** — Confirm the internal ALB route resolves and returns item metadata for a known public handle.

These steps are documented in `docs/spike/jscholarship-schema-spike.md` and will be executed when stage access is available.
