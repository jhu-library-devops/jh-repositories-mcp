# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repository currently contains **no source code** — only a Kiro spec for a project that has not been scaffolded yet. There is no `package.json`, `src/`, build tooling, or tests. Before assuming any command (`bun test`, `tsc`, etc.) works, check whether the code described below actually exists yet. If asked to start implementation, follow the spec's own phased plan (see "Implementation plan" below) rather than inventing a different structure.

The spec lives at `.kiro/specs/jscholarship-jhrdr-mcp/` and has three parts:

- `requirements.md` — user stories and numbered acceptance criteria (Requirements 1–17), plus a glossary of domain terms (`MCP_Server`, `Repository`, `Canonical_API`, `Public_Record`, `Cursor`, etc.). Treat this glossary as authoritative terminology when discussing the design.
- `design.md` — the architecture, component interfaces, data models, and rollout phases (Phases 0–4). This is the primary technical reference.
- `tasks.md` — a numbered, dependency-ordered implementation checklist (tasks 1–26) that maps back to requirement IDs. This is the intended build order.

When making changes to the spec itself, keep `requirements.md`, `design.md`, and `tasks.md` mutually consistent — each maps to the others via requirement numbers (e.g. `_Requirements: 2.4-2.6, 9.3-9.4_`).

## What this project is

A read-only Model Context Protocol (MCP) server that lets AI research assistants search and cite two independently run Johns Hopkins repositories through one federated interface:

- **JScholarship** — institutional repository on **DSpace**, indexed by a SolrCloud `search` collection, resolved through DSpace REST.
- **JHRDR** (Johns Hopkins Research Data Repository) — research data repository on **Dataverse**, indexed by a Solr `collection1` collection, resolved through the Dataverse Native API.

Intended runtime: strict TypeScript on **Bun**, using the official MCP TypeScript SDK's Web Standard Streamable HTTP transport (not the Node.js transport), Hono for HTTP, deployed as ECS Fargate tasks in the shared repository VPC.

v1 is deliberately narrow: no embedded LLM, no vector search, no write/admin operations, no file-content proxying, no auth (anonymous read-only). Any capability outside Requirement 17's boundaries needs a new/revised spec before implementation — don't casually add scope.

## Core architectural decisions (from design.md)

- **Two adapters behind one interface.** JScholarship and JHRDR are *not* made to look identical internally — a `RepositoryAdapter` interface (`search`, `get`, `facets`, `related`, `validateSchema`) is implemented once per platform, and only adapters may know Solr field names or construct repository URLs.
- **Solr for candidates, Canonical API for truth.** Every adapter queries its private Solr collection for fast candidate retrieval, but every record actually returned must be re-validated and re-fetched through the platform's own public API (DSpace REST / Dataverse Native API). A candidate that fails canonical validation is silently dropped — Solr-only metadata is never returned. This is the core anti-data-leak mechanism (see Property 6 and Requirement 9).
- **Immutable public filters.** Each `RepositoryProfile` bakes in non-overridable filters (e.g. non-withdrawn/discoverable/latest for DSpace; published/non-draft/non-deaccessioned for Dataverse). No client input can weaken these (Requirement 9.2, Property 3).
- **Field allowlists only, no raw Solr passthrough.** All query fields, filters, sorts, facets, and related-record fields are mapped through a per-repository `Field_Allowlist`; there is no raw Solr query parameter exposed to clients (Requirement 10).
- **Indistinguishable not-found.** A nonexistent identifier and a non-public (withdrawn/draft/restricted) identifier must return the exact same `not_found` shape — this prevents using the MCP to probe for the existence of restricted content (Requirement 9.5, Property 7).
- **Namespaced, cross-platform-stable record IDs.** IDs are prefixed by repository (`jscholarship:<uuid>` / `jhrdr:<persistent-id>`) so identifiers from the two platforms can never collide (Property 9).
- **No cross-repository score comparison.** DSpace and Dataverse Solr scores aren't comparable, so federation never compares raw scores. Instead each adapter preserves its own `Repository_Rank`, and federation merges via balanced reciprocal-rank fusion (`fusionScore = repositoryWeight / (60 + repositoryRank)`) with deterministic alternating tie-breaks (Requirement 11, Properties 10–11).
- **Stateless federation via opaque cursor.** Pagination state (per-repository offsets, query hash, next tie source) lives entirely in a versioned, base64url-encoded `Cursor` — no server-side session state, so any Fargate task can serve any request (Requirement 11.4, Property 12).
- **Fail-closed everywhere.** Backend timeout, validation failure, or schema mismatch all result in omission/error, never in returning unvalidated data. Startup itself fails readiness if a repository's *required* Solr schema fields are missing (optional fields degrade gracefully instead).
- **Metadata is untrusted data.** Record metadata (titles, abstracts, etc.) must never be interpolated into prompt/instruction roles — it's sanitized and treated as literal data (Requirement 8.6, Property 15).

## MCP surface (v1, fixed scope)

| Type | Name | Purpose |
| --- | --- | --- |
| Tool | `search_items` | Federated search across one or both repositories with filters + cursor pagination |
| Tool | `get_item` | Resolve a single record through its canonical repository API |
| Tool | `list_facets` | Return approved common/repository-qualified facets |
| Tool | `find_related_items` | Related-record discovery within or across repositories |
| Tool | `explain_search` | Human-readable explanation of interpreted query/filters (no backend syntax leaked) |
| Resource | `jhu-repo://jscholarship/item/{encodedIdentifier}` | Read a canonical JScholarship record |
| Resource | `jhu-repo://jhrdr/dataset/{encodedIdentifier}` | Read a canonical JHRDR dataset |
| Prompt | `explore_research_topic` | Guided iterative cross-repository search |
| Prompt | `find_reusable_data` | Guided dataset discovery/evaluation |

Do not add tools/resources/prompts beyond this list without updating the spec first — Requirement 17 and the MCP Registry section of `design.md` treat this as a closed, static registry (`additionalProperties: false` on every schema, no dynamic tool creation).

## Intended source layout (per design.md §14, not yet created)

```
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
test/
  fixtures/
  integration/
  property/
```

## Intended tooling/commands (per design.md §14, once scaffolded)

- Runtime/package manager/bundler/test runner: **Bun**, pinned via `.bun-version`, with `bun.lock` committed.
- Install: `bun ci`
- Type-check: `tsc --noEmit` (Bun's bundler does not replace this)
- Test: `bun test`
- Build: `bun build --target=bun --production`

Property-based tests are expected to run ≥100 generated cases per property (see the 15 correctness properties in `design.md`, e.g. "every emitted Solr field is allowlisted," "unsafe query syntax cannot change structure").

## Implementation plan

`tasks.md` defines the build order — start at task 1 (Phase 0: verify actual deployed DSpace/Dataverse schema fields and public-access filters against real fixtures) before writing adapter code, since the immutable public filters and field allowlists in `design.md` are provisional pending that verification. Tasks are grouped roughly as: Phase 0 spike (1) → scaffolding/models/profiles (2–4) → safe Solr query layer (5) → DSpace client + adapter (6–7) → Dataverse client + adapter (8–9) → federation/ranking (10) → the five tools (11–15) → HTTP/MCP transport (16) → resilience/caching (17) → observability (18) → containerization (19) → infra (20–21) → CI/CD (22) → verification (23) → stage deploy (24) → pilot evaluation (25) → production release (26).
