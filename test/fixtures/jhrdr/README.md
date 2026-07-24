# JHRDR (Dataverse) Test Fixtures

## Status

Fixtures for the Johns Hopkins Research Data Repository (JHRDR / Dataverse) will be captured during the Dataverse adapter implementation tasks (tasks 8 and 9).

## Planned Fixtures

The following fixtures will be added once the JHRDR Dataverse adapter work begins:

- **`solr-schema.json`** — Deployed Dataverse 6.10.1 Solr `collection1` schema fields relevant to the MCP
- **`solr-search-response.json`** — Synthetic Dataverse Solr search response with public, draft, and deaccessioned datasets
- **`solr-public-dataset.json`** — Single Solr document for a published public dataset
- **`solr-draft-dataset.json`** — Single Solr document for a draft dataset (excluded by immutable filters)
- **`solr-deaccessioned-dataset.json`** — Single Solr document for a deaccessioned dataset (excluded)
- **`dataverse-api-dataset.json`** — Dataverse Native API response for a public dataset (latest published version)
- **`dataverse-api-files.json`** — Dataverse Native API file listing with public and restricted files
- **`dataverse-api-not-found.json`** — Dataverse Native API 404 response

## Requirements

- Requirements: 3.1-3.8, 9, 16.1-16.2
- Tasks: 8.1-8.4, 9.1-9.4
