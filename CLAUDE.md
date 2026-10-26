# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

The service is implemented. For what remains to be built, read the unchecked
items in `.kiro/specs/*/tasks.md` directly; this file does not track progress.

**Code is ground truth.** Where a document in this repo disagrees with the
source, believe the source and say so rather than silently reconciling.

The Kiro spec at `.kiro/specs/jscholarship-jhrdr-mcp/` remains the design
authority for intent and scope:

- `requirements.md` — user stories and numbered acceptance criteria
  (Requirements 1–17) plus a glossary of domain terms. Treat the glossary as
  authoritative terminology.
- `design.md` — architecture, component interfaces, data models, the
  correctness properties, and rollout phases.
- `tasks.md` — the dependency-ordered implementation checklist (1–26), with
  completion state.

Source comments cite these by number (`_Requirements: 2.4-2.6_`). When changing
the spec, keep all three files mutually consistent.

The published developer reference is `docs/` (built with VitePress, deployed
to GitHub Pages). `docs/reference/` is generated from source by
`bun run docs:generate`; never edit it by hand. Hand-written pages declare the
code they describe in `sources:` front matter. When you change that code, check
those pages and bump their `verified:` date. Pages describe the system as built:
no task numbers, plans, or progress notes. See `docs/guides/maintaining-docs.md`.

`docs/glossary.md` is the domain glossary (SearchResult, ItemDetail, Candidate,
Public Record, Canonical API, Field Allowlist, Immutable Public Filter, Cursor,
Repository Rank); `CONTEXT.md` points to it and keeps the example dialogue. Use
that vocabulary precisely. `docs/adr/` holds 13 accepted ADRs recording why each
structural decision was made. `.kiro/steering/docs-writing-style.md` is the
register for every page under `docs/` and the root documents.

## What this project is

A read-only Model Context Protocol (MCP) server that lets AI research
assistants search and cite two independently run Johns Hopkins repositories
through one federated interface:

- **JScholarship** — institutional repository on **DSpace**, indexed by a
  SolrCloud `search` collection, resolved through DSpace REST.
- **JHRDR** (Johns Hopkins Research Data Repository) — research data repository
  on **Dataverse**, indexed by a Solr `collection1` collection, resolved through
  the Dataverse Native API.

Runtime: strict TypeScript on **Bun**, using the MCP TypeScript SDK's Web
Standard Streamable HTTP transport (not the Node.js transport) with Hono,
deployed as ECS Fargate tasks in the shared repository VPC.

v1 is deliberately narrow: no embedded LLM, no vector search, no write/admin
operations, no file-content proxying, no auth (anonymous read-only). Any
capability outside Requirement 17's boundaries needs a new or revised spec
before implementation — don't casually add scope.

## Core architectural invariants

These are cross-cutting. Do not answer a question about behavior, or change
behavior, from a single file — trace the path end to end.

- **Adapters behind one versioned interface.** JScholarship and JHRDR are *not*
  made to look identical internally. `RepositoryAdapter` in
  `src/adapters/index.ts` (`contractVersion`, `search`, `get`, `facets`,
  `related`, `validateSchema`, `probePublic`, all required) is implemented once
  per platform, and only adapters may know Solr field names or construct
  repository URLs. There is deliberately no shared `isPublic()`. At startup the
  constructed adapters are registered into an immutable `AdapterRegistry`
  (`src/adapters/registry.ts`) that records each one's fusion weight and
  dispatch eligibility; the federation layer resolves adapters only through it
  and names no repository. (ADR-004, ADR-013)
- **Solr for candidates, Canonical API for truth.** Adapters query their private
  Solr collections for fast candidate retrieval, but only records validated
  through the platform's public API should enter results; failures are silently
  dropped and Solr-only metadata is never returned. Requirement 15.4 and the
  design require cached search candidates to be revalidated before return.
  Current `src/adapters/caching.ts` instead reuses bounded-TTL pages that passed
  canonicalization when first cached; treat this as known implementation drift,
  not an exception to the public gate. Cached direct-item records are re-probed
  through the public API before they are emitted. (ADR-005, Requirements 9,
  15.4, and 15.9)
- **Immutable public filters.** Each `RepositoryProfile` bakes in
  non-overridable filters (non-withdrawn/discoverable/latest/archived for
  DSpace; published/non-draft/non-deaccessioned for Dataverse). No client input
  can weaken them. (Requirement 9.2)
- **Field allowlists only, no raw Solr passthrough.** All query fields, filters,
  sorts, facets, and related-record fields map through a per-repository
  `Field_Allowlist` in `config/repositories/`. Unmapped concepts produce an
  `unsupported_filter` warning, never raw Solr syntax. (Requirement 10)
- **Indistinguishable not-found.** A nonexistent identifier and a non-public one
  return the exact same `not_found` shape, and client-visible errors are
  deliberately opaque. This prevents probing for restricted content.
  (Requirement 9.5)
- **Namespaced record IDs.** `jscholarship:<uuid>` / `jhrdr:<persistent-id>`, so
  identifiers from the two platforms cannot collide.
- **No cross-repository score comparison.** DSpace and Dataverse Solr scores
  aren't comparable. Each adapter preserves its own `Repository_Rank`, and
  `src/federation/merge.ts` merges N pages via weighted reciprocal-rank fusion
  (`weight / (k + rank)`, `k = 60`, weights default 1.0) with a round-robin tie
  sequence over the participating repositories and the namespaced ID as the
  final tie-break. (ADR-007, ADR-013)
- **Stateless federation via opaque cursor.** The versioned base64url `Cursor`
  (v2: `queryHash`, one offset per contributing repository, the participating
  set, and the tie-sequence position; v1 still decodes) carries all pagination
  state — no server-side session. A cursor whose query hash doesn't match, or
  that names a repository no longer selected, resets to page 1 with
  `cursor_reset`; a newly selected repository starts at zero with
  `cursor_expanded`. Fan-out is bounded by a canonicalization budget (150
  candidates) and a 10 s federation deadline (`deadline_exceeded` on a partial).
  (ADR-006, ADR-012, ADR-013)
- **Fail-closed everywhere.** Backend timeout, validation failure, or schema
  mismatch results in omission or an error, never unvalidated data. Config
  validation is fail-fast at startup. Readiness fails if a repository's
  *required* Solr schema fields are missing (optional fields degrade and are
  reported as `disabledFeatures`).
- **Metadata is untrusted data.** Record metadata is never interpolated into
  prompt or instruction roles, and logs are built by allowlist, not denylist.
  (Requirement 8.6)

## MCP surface (v1, fixed scope)

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

`src/mcp/registry.ts` holds this as a closed static table with
`additionalProperties: false` on every schema and no dynamic tool creation.
`test/integration/excluded-capabilities.test.ts` fails if the surface grows. Do
not add tools/resources/prompts without updating the spec first.

## Source layout

```
src/
  index.ts                   Hono app, health/version routes, adapter wiring, startup schema validation
  mcp/                       transport.ts, registry.ts, tools/, resources.ts, prompts.ts, errors.ts
  adapters/                  index.ts (the interface), registry.ts (startup adapter registry),
                             solr-query.ts, solr-client.ts, solr-schema-validator.ts,
                             canonicalize.ts, caching.ts, retry.ts, explain.ts, jscholarship/, jhrdr/
  federation/                service.ts (the pipeline), selector.ts, cursor.ts, reconcile.ts,
                             window-allocation.ts, deadline.ts, merge.ts, tie-sequence.ts,
                             partial-assembly.ts, facet-merge.ts (unwired), index.ts (barrel)
  models/                    domain types, zod schemas, ID namespacing, factories
  observability/index.ts     redacting logger, CloudWatch EMF metrics
  security/index.ts          host/origin checks, edge + deadline middleware, semaphore
  cache/lru.ts               bounded TTL LRU
config/repositories/         RepositoryProfiles and endpoint definitions
infra/                       OpenTofu: modules/mcp-shared, modules/mcp-service, environments/
test/                        unit/, property/, contract/, integration/, spike/, fixtures/
docs/adr/, docs/spike/
```

`src/adapters/index.ts` is the architectural seam. Nothing above it (federation,
tools, registry, transport) may know that Solr, DSpace, or Dataverse exist.

## Commands

- Install: `bun install --frozen-lockfile` (honors `.bun-version` and the
  committed `bun.lock`). The pinned Bun is 1.3.11, where `bun ci` is an
  equivalent alias; CI and the Dockerfile use the long form.
- Type-check: `bun run typecheck` (`tsc --noEmit` — Bun's bundler does not
  type-check)
- Test: `bun test`
- Lint / format: `bun run lint` (`biome check .`) / `bun run format`
- Dev server: `bun run dev` (requires env; see below)
- Build: `bun run build`
- Changelog: `bun run changelog:new` to add a `changelog.d/` fragment. Do not
  hand-edit `CHANGELOG.md`.
- Docs: `bun run docs:generate` after changing the MCP surface, configuration,
  repository profiles, error codes, or `infra/`; `bun run docs:check` before a
  PR; `bun run docs:dev` to preview the site.

CI (`.github/workflows/ci.yml`) runs install → lint → docs checks → typecheck →
test → build plus a dependency audit.

## Environment

<!-- docs:inject configuration-summary -->
Required (startup fails without them): `ENVIRONMENT`, `BUILD_VERSION`, `BUILD_COMMIT`, `JSCHOLARSHIP_SOLR_URL`, `JSCHOLARSHIP_API_URL`, `JSCHOLARSHIP_PUBLIC_URL`, `ALLOWED_HOSTS`.

Optional or defaulted: `PORT`, `JHRDR_SOLR_URL`, `JHRDR_API_URL`, `JHRDR_PUBLIC_URL`, `ALLOWED_ORIGINS`, `TIMEOUT_SOLR_MS`, `TIMEOUT_API_MS`, `TIMEOUT_DEADLINE_MS`, `MAX_TOOL_CONCURRENCY`, `MAX_CANONICALIZATION_WORKERS`, `CACHE_SEARCH_TTL_MS`, `CACHE_RECORD_TTL_MS`, `CACHE_MAX_ENTRIES`, `MAX_BODY_BYTES`.
<!-- /docs:inject -->

Descriptions and defaults: `docs/reference/configuration.md`.

The JHRDR adapter is only constructed when `JHRDR_SOLR_URL` and `JHRDR_API_URL`
are set, so the service runs single-repository without them.

`GET /health/live` reports process
liveness; `GET /health/ready` returns 503 until Solr schema validation passes.

## Testing

`test/` is organized by kind and the kinds mean different things:

- `unit/` — module-level behavior
- `property/` — invariants as `fast-check` generated cases, **at least 100 per
  property**. New invariants belong here.
- `contract/` — platform clients against recorded fixtures
- `integration/` — the assembled server; `non-public-disclosure.test.ts` and
  `excluded-capabilities.test.ts` are the guardrails
- `fixtures/` — sanitized real payloads including deliberately
  withdrawn/restricted records. Read `test/fixtures/*/README.md` before adding
  any; never commit an unsanitized payload or a credential.

Prioritize coverage of public-record filtering, Solr escaping, canonical API
validation, indistinguishable not-found, cursor determinism, log redaction, and
fail-closed behavior.

## Conventions

Strict TypeScript, two-space indent, Biome-governed formatting (double quotes,
trailing commas, 100-col). `camelCase` for functions and variables, `PascalCase`
for types and classes, lowercase repository IDs (`jscholarship`, `jhrdr`), and
the fixed snake_case MCP names (`search_items`). Keep repository-specific
mapping, URLs, filters, and allowlists inside the corresponding adapter.

Commits use short, imperative, sentence-case subjects. Pull requests should
summarize scope, cite affected requirement and task numbers, list verification
performed, and call out schema, security, configuration, or infrastructure
impacts. Never commit credentials, private endpoints, or unreviewed repository
payloads.

Team standards live in `.kiro/steering/` — TypeScript formatting, error
handling, logging, security, and testing practices.

## Known rough edges

Verify before relying on any of these; they may have been fixed.

- `zod-to-json-schema` is imported in `src/mcp/registry.ts` but is not declared
  in `package.json` (resolves transitively today).
- `TIMEOUT_API_MS` / `config.timeouts.canonicalApiMs` is parsed but never read;
  both platform clients receive the Solr timeout.
- `JHRDR_SOLR_URL` / `JHRDR_API_URL` are not URL-validated, so a malformed
  non-empty value throws in the adapter constructor outside the guarded
  `loadConfig`.
- `disabledFeatures` from schema validation is reported but not enforced — the
  JScholarship `related()` path still issues MoreLikeThis queries (on `/select`)
  when `*_mlt` fields are missing.
- `filters.access` is accepted by the input schema and always produces an
  `unsupported_filter` warning; no adapter implements it.
- `find_related_items` can return fewer than `limit` results, because the source
  record is filtered out after the merge trims.
- `src/federation/facet-merge.ts` (N-way facet merging) exists but `list_facets`
  does not call it; facets are still returned per repository.
- Federation limits (`k`, canonicalization budget, deadline, fusion weights, max
  adapters = 8) are code constants in `src/index.ts` and the handlers, not
  environment configuration.
- The 10 s federation deadline sits under `TIMEOUT_DEADLINE_MS`; raising the
  latter past 10 s does not give a search more time.
- `GET /health/ready` also reports 503 with a `code` when the adapter registry
  could not be built; the process then exits.
- The ECS container health check and the ALB target group both probe
  `/health/live`, not `/health/ready`, so a task whose schema validation failed
  still receives traffic.
- JHRDR's Solr-side `discoverableBy:Anonymous` clause is commented out pending
  verification, so the Dataverse `versionState === "RELEASED"` check carries the
  gate. `config/repositories/jhrdr-endpoints.ts` is a self-declared stub.
