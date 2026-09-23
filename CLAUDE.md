# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

The service is implemented. `src/`, `config/`, `test/`, `infra/`, `Dockerfile`,
`package.json`, and CI workflows all exist. Per
`.kiro/specs/jscholarship-jhrdr-mcp/tasks.md`, tasks 1–19 and 22–24 are
complete; the open work is task 20 (OpenTofu stack), 21 (public edge), 25
(pilot evaluation), and 26 (production release).

**Code is ground truth.** Where a document in this repo disagrees with the
source, believe the source and say so rather than silently reconciling.

The Kiro spec at `.kiro/specs/jscholarship-jhrdr-mcp/` remains the design
authority for intent and scope:

- `requirements.md` — user stories and numbered acceptance criteria
  (Requirements 1–17) plus a glossary of domain terms. Treat the glossary as
  authoritative terminology.
- `design.md` — architecture, component interfaces, data models, the 15
  correctness properties, and rollout phases.
- `tasks.md` — the dependency-ordered implementation checklist (1–26), with
  completion state.

Source comments cite these by number (`_Requirements: 2.4-2.6_`). When changing
the spec, keep all three files mutually consistent.

`CONTEXT.md` is the domain glossary (SearchResult, ItemDetail, Candidate,
Public_Record, Canonical_API, Field_Allowlist, Immutable_Public_Filter, Cursor,
Repository_Rank). Use its vocabulary precisely. `docs/adr/` holds 12 accepted
ADRs recording why each structural decision was made.

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

- **Two adapters behind one interface.** JScholarship and JHRDR are *not* made
  to look identical internally. `RepositoryAdapter` in `src/adapters/index.ts`
  (`search`, `get`, `facets`, `related`, `validateSchema`, optional
  `probePublic`) is implemented once per platform, and only adapters may know
  Solr field names or construct repository URLs. There is deliberately no shared
  `isPublic()`. (ADR-004)
- **Solr for candidates, Canonical API for truth.** Every adapter queries its
  private Solr collection for fast candidate retrieval, but every record
  returned is re-fetched and re-validated through the platform's own public API.
  A candidate that fails validation is silently dropped; Solr-only metadata is
  never returned. Implemented in `src/adapters/canonicalize.ts`
  (`canonicalizeInOrder`) plus each platform client's public gate. (ADR-005,
  Requirement 9)
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
  `src/federation/index.ts` merges via balanced reciprocal-rank fusion
  (`weight / (60 + rank)`) with deterministic alternating tie-breaks. (ADR-007)
- **Stateless federation via opaque cursor.** Per-repository offsets, query
  hash, and next tie source live entirely in a versioned base64url `Cursor` — no
  server-side session state. A cursor whose query hash doesn't match resets to
  page 1 with a warning rather than erroring. (ADR-006, ADR-012)
- **Fail-closed everywhere.** Backend timeout, validation failure, or schema
  mismatch results in omission or an error, never unvalidated data. Config
  validation is fail-fast at startup. Readiness fails if a repository's
  *required* Solr schema fields are missing (optional fields degrade and are
  reported as `disabledFeatures`).
- **Metadata is untrusted data.** Record metadata is never interpolated into
  prompt or instruction roles, and logs are built by allowlist, not denylist.
  (Requirement 8.6)

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

`src/mcp/registry.ts` holds this as a closed static table with
`additionalProperties: false` on every schema and no dynamic tool creation.
`test/integration/excluded-capabilities.test.ts` fails if the surface grows. Do
not add tools/resources/prompts without updating the spec first.

## Source layout

```
src/
  index.ts                   Hono app, health/version routes, adapter wiring, startup schema validation
  mcp/                       transport.ts, registry.ts, tools/, resources.ts, prompts.ts, errors.ts
  adapters/                  index.ts (the interface), solr-query.ts, solr-client.ts,
                             solr-schema-validator.ts, canonicalize.ts, caching.ts, retry.ts,
                             explain.ts, jscholarship/, jhrdr/
  federation/index.ts        RRF merge, cursor encode/decode, response assembly
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
  committed `bun.lock`). Don't use `bun ci`: it doesn't exist in the pinned
  Bun 1.2.15 (`error: Script not found "ci"`).
- Type-check: `bun run typecheck` (`tsc --noEmit` — Bun's bundler does not
  type-check)
- Test: `bun test`
- Lint / format: `bun run lint` (`biome check .`) / `bun run format`
- Dev server: `bun run dev` (requires env; see below)
- Build: `bun run build`
- Changelog: `bun run changelog:new` to add a `changelog.d/` fragment. Do not
  hand-edit `CHANGELOG.md`.

CI (`.github/workflows/ci.yml`) runs install → lint → typecheck → test → build
plus a dependency audit.

## Environment

Required (startup fails without them): `ENVIRONMENT` (`stage`|`production`),
`BUILD_VERSION`, `BUILD_COMMIT`, `JSCHOLARSHIP_SOLR_URL`,
`JSCHOLARSHIP_API_URL`, `JSCHOLARSHIP_PUBLIC_URL`, `ALLOWED_HOSTS` (comma list,
at least one entry).

Optional/defaulted: `PORT`, `JHRDR_SOLR_URL`, `JHRDR_API_URL`,
`JHRDR_PUBLIC_URL`, `ALLOWED_ORIGINS`, `TIMEOUT_SOLR_MS`, `TIMEOUT_API_MS`,
`TIMEOUT_DEADLINE_MS`, `MAX_TOOL_CONCURRENCY`, `MAX_CANONICALIZATION_WORKERS`,
`CACHE_SEARCH_TTL_MS`, `CACHE_RECORD_TTL_MS`, `CACHE_MAX_ENTRIES`,
`MAX_BODY_BYTES`.

The JHRDR adapter is only constructed when all three JHRDR URLs are set, so the
service runs single-repository without them. `GET /health/live` reports process
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
  JScholarship `related()` path still issues `/mlt` queries.
- `filters.access` is accepted by the input schema and always produces an
  `unsupported_filter` warning; no adapter implements it.
- `find_related_items` can return fewer than `limit` results, because the source
  record is filtered out after the merge trims.
- JHRDR's Solr-side `discoverableBy:Anonymous` clause is commented out pending
  verification, so the Dataverse `versionState === "RELEASED"` check carries the
  gate. `config/repositories/jhrdr-endpoints.ts` is a self-declared stub.
