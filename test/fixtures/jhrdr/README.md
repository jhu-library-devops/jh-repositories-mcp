# JHRDR (Dataverse 6.10.1) Test Fixtures

## Overview

Sanitized fixtures for the Johns Hopkins Research Data Repository (JHRDR / Dataverse 6.10.1).
No credentials, private endpoints, or unreviewed repository payloads are included.

## Fixtures

### `solr-schema.json`

Documents the key Dataverse 6.10.1 Solr `collection1` schema fields relevant to the MCP.
Extracted from `jhu-dataverse-deployment/config/solr/schema.xml`.

Contents:
- **System/identity fields** — `id`, `entityId`, `dvObjectType`, `publicationStatus`, `identifier`, `persistentUrl`, `dateSort`, `nameSort`
- **Citation metadata fields** — `title`, `authorName`, `authorAffiliation`, `authorIdentifier`, `dsDescriptionValue`, `subject`, `keywordValue`, `topicClassValue`, `license`, `fileCount`, `citation`
- **Hierarchy fields** — `parentId`, `parentIdentifier`, `parentName`, `subtreePaths`
- **Access control** — `discoverableBy` (TODO: verify anonymous value)
- **Catchall** — `_text_` (text_general, populated via copyField)
- **Excluded file-level fields** — listed but not used (filtered by `dvObjectType:Dataset`)
- **Public filter explanation** — documents immutable filter logic

### `dataverse-api-dataset.json`

Synthetic Dataverse Native API response for `GET /api/datasets/:persistentId/versions/:latest-published`.
Published public dataset (fake DOI `doi:10.7281/T1ABCDEF`) with two public files and one
restricted file that clients must exclude from summaries.

### `solr-search-response.json`

Synthetic Dataverse Solr `collection1` search response with two published public datasets,
carrying the immutable public filters in `responseHeader.params.fq`.

### Planned Fixtures

- **`solr-search-response.json`** — Synthetic Dataverse Solr search response with public, draft, and deaccessioned datasets
- **`solr-public-dataset.json`** — Single Solr document for a published public dataset
- **`solr-draft-dataset.json`** — Single Solr document for a draft dataset (excluded by immutable filters)
- **`solr-deaccessioned-dataset.json`** — Single Solr document for a deaccessioned dataset (excluded)
- **`dataverse-api-dataset.json`** — Dataverse Native API response for a public dataset (latest published version)
- **`dataverse-api-files.json`** — Dataverse Native API file listing with public and restricted files
- **`dataverse-api-not-found.json`** — Dataverse Native API 404 response

## Source

- Schema: `jhu-dataverse-deployment/config/solr/schema.xml`
- Platform: Dataverse 6.10.1
- Collection: `collection1`

## Requirements

- Requirements: 3.1-3.8, 9, 10.2, 16.1-16.2
- Tasks: 4.2, 8.1-8.4, 9.1-9.4
