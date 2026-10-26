# jh-repositories-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server that
gives AI research assistants one federated search over two Johns Hopkins
repositories:

- **JScholarship**, the institutional repository (theses, articles, reports), on
  DSpace.
- **JHRDR**, the Johns Hopkins Research Data Repository (datasets), on Dataverse.

Different platforms, different metadata models, different notions of "published."
A researcher asking *"what has Hopkins published on X, and is there data I can
reuse?"* shouldn't have to know any of that.

Strict TypeScript on [Bun](https://bun.sh), with [Hono](https://hono.dev) and the
MCP TypeScript SDK's Web Standard Streamable HTTP transport, deployed as ECS
Fargate tasks.

## The one idea

> **Solr finds candidates. The canonical API decides truth.**

Each repository's private Solr index proposes records; only the platform's public
API, called anonymously, confirms one before it is returned. Without that gate, a
thesis withdrawn this morning would still be returned this afternoon. The whole
design protects one guarantee: never disclose a record that isn't public, and
never let a client infer that one exists.
[How the gate works](docs/architecture/canonical-gate.md) ·
[Why it was chosen](docs/adr/ADR-005-solr-candidates-canonical-api-gate.md)

## MCP surface

Closed and fixed: no dynamic registration, strict schemas throughout. Full
schemas are in the [MCP surface reference](docs/reference/mcp-surface.md).

<!-- docs:inject mcp-surface-summary -->
| Type | Name | Purpose |
| --- | --- | --- |
| Tool | `search_items` | Search JScholarship (publications) and/or JHRDR (research datasets) with structured filters and cursor pagination. Returns citation-ready public records only. |
| Tool | `get_item` | Resolve one public record by namespaced ID, UUID, Handle, DOI, or Dataverse persistent identifier, with full canonical metadata and public file summaries. |
| Tool | `list_facets` | List approved facets (repository, creator, subject, year, resourceType, collection) with per-repository counts for refining a search. |
| Tool | `find_related_items` | Find public records related to a known publication or dataset, within or across the two repositories. |
| Tool | `explain_search` | Explain how a search would be interpreted per repository (concepts searched, filters applied or unsupported, sort) without executing it. |
| Resource | `jhu-repo://jscholarship/item/{encodedIdentifier}` | Canonical public JScholarship record by encoded identifier |
| Resource | `jhu-repo://jhrdr/dataset/{encodedIdentifier}` | Canonical public JHRDR dataset by encoded identifier |
| Prompt | `explore_research_topic` | Iteratively explore JHU repository holdings (publications and datasets) on a research topic, with citations to persistent identifiers. |
| Prompt | `find_reusable_data` | Discover and evaluate reusable JHRDR datasets for a research need, including related JScholarship publications. |
<!-- /docs:inject -->

v1 is anonymous and read-only, with no embedded model, vector search, writes, or
file-content proxying. Adding to this list is a spec change, not a feature PR;
see [Scope](CONTRIBUTING.md#scope).

## Get started

- **Run it.** [Run the server locally](docs/guides/local-development.md) takes
  you from a clone to a server answering `tools/list`.
- **Learn it.** The [developer reference](https://jhu-library-devops.github.io/jh-repositories-mcp/)
  has [concepts](docs/architecture/concepts.md) for whichever half of the stack
  is new to you, the [architecture](docs/architecture/overview.md), task
  [guides](docs/guides/local-development.md), and the
  [decision records](docs/adr/README.md). [`ONBOARDING.md`](ONBOARDING.md) is
  the new-contributor path, including a Claude Code skill that gives a guided
  tour of the code.
- **Change it.** [`CONTRIBUTING.md`](CONTRIBUTING.md) covers tests, fixtures,
  changelog fragments, and pull requests.
- **Deploy it.** [Deploy and roll back](docs/guides/deploy-and-rollback.md),
  then verify with `./scripts/smoke-test.sh https://<service-host>`.

## Documentation

| Where | What it's for |
| --- | --- |
| [Developer reference](https://jhu-library-devops.github.io/jh-repositories-mcp/) ([`docs/`](docs/index.md)) | Concepts, architecture, guides, decision records, and the generated reference for the MCP surface, configuration, repositories, errors, and infrastructure |
| [Glossary](docs/glossary.md) | The domain vocabulary: the terms to use, and the ones to avoid |
| [`ONBOARDING.md`](ONBOARDING.md) | New-contributor path and the onboarding skill |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to make a change: tests, fixtures, scope, commits, PRs |
| [`CLAUDE.md`](CLAUDE.md), [`AGENTS.md`](AGENTS.md) | Guidance for coding agents |
| [`.kiro/specs/`](.kiro/specs/) | Requirements, designs, and task plans (working records, not published) |
| [`docs/spike/`](docs/spike/) | Schema and network investigations (working records, not published) |

**Where a document and the source disagree, the source wins.** Fix the document.

## License

Copyright 2026 Johns Hopkins University Libraries. Authors: Steven J. Miklovic and Jared Galanis.

Licensed under the [Apache License 2.0](LICENSE).
