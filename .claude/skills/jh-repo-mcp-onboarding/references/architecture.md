# Architecture reference — jhu-repository-mcp

Everything here was read out of the source. Paths are repo-relative. If
something below no longer matches the code, the code wins — say so and correct
course.

## Contents

- [Module map](#module-map)
- [The request path, hop by hop](#the-request-path-hop-by-hop)
- [The RepositoryAdapter interface](#the-repositoryadapter-interface)
- [Where each invariant is actually enforced](#where-each-invariant-is-actually-enforced)
- [Federation, ranking, and cursors](#federation-ranking-and-cursors)
- [Configuration and startup](#configuration-and-startup)
- [Security and observability](#security-and-observability)
- [Tests](#tests)
- [Deployment and CI](#deployment-and-ci)
- [Sharp edges worth knowing](#sharp-edges-worth-knowing)
- [Common change recipes](#common-change-recipes)

## Module map

```
src/
  index.ts                  Hono app, health/version routes, adapter wiring, startup schema validation
  mcp/
    transport.ts            Streamable HTTP transport mount (POST only)
    registry.ts             The closed tool/resource/prompt table + result rendering
    tools/                  One file per tool: search-items, get-item, list-facets,
                            find-related-items, explain-search
    resources.ts            jhu-repo:// URI parsing, delegates to get-item
    prompts.ts              The two guided prompts
    errors.ts               ToolFailure and the client-visible error codes
  adapters/
    index.ts                The RepositoryAdapter interface (this is the seam)
    solr-query.ts           Allowlisted query construction and escaping
    solr-client.ts          Solr HTTP, POST form body, redirect: "error"
    solr-schema-validator.ts Startup Schema API check
    canonicalize.ts         The candidate -> validated record gate
    caching.ts              withCaching() decorator
    retry.ts                withRetry()
    explain.ts              Human-readable strategy explanation
    jscholarship/           DSpace adapter + dspace-client.ts
    jhrdr/                  Dataverse adapter + dataverse-client.ts
  federation/index.ts       Reciprocal-rank merge, cursor encode/decode, response assembly
  models/                   Domain types, zod schemas, ID namespacing, factories
  security/index.ts         Host/Origin checks, edge + deadline middleware, semaphore
  observability/index.ts    Redacting logger, CloudWatch EMF metrics
  cache/lru.ts              Bounded TTL LRU
config/repositories/        RepositoryProfiles (field allowlists, immutable filters) and endpoints
test/{unit,property,contract,integration,spike,fixtures}/
infra/                      OpenTofu: modules/mcp-service, modules/mcp-shared, environments/
docs/                       Published developer reference (VitePress site)
  reference/                Generated from source by `bun run docs:generate`; never hand-edit
  architecture/, guides/    Hand-written; each page lists its `sources:` in front matter
  adr/                      14 accepted ADRs
  spike/                    Schema and route investigations (not published)
  .vitepress/               Site config and the JHU brand theme
scripts/docs/               Reference generators and docs checks (paths, public content, staleness, PR impact)
.kiro/specs/<feature>/      requirements.md, design.md, tasks.md per feature (working records, not published)
```

The single most important structural fact: **`src/adapters/index.ts` is the
seam.** Solr field names, platform URLs, and platform access semantics live
below it, inside an adapter. Nothing above it (federation, tools, registry,
transport) knows that Solr or DSpace or Dataverse exist. Violating that is the
architectural mistake this codebase is most vulnerable to, because it's always
locally convenient.

## The request path, hop by hop

Trace `search_items` and you have traced 80% of the system.

1. **`src/index.ts`** — `loadConfig()` at module scope; on failure the process
   exits 1 (fail-fast config). Adapters are constructed once at module scope and
   wrapped: `withCaching(new JScholarshipAdapter({...}))`, and the same for
   `JhrdrAdapter` **only if `JHRDR_SOLR_URL` and `JHRDR_API_URL` are set**
   (`JHRDR_PUBLIC_URL` has a default) — so JHRDR is
   optional at runtime and the server happily serves JScholarship alone.
   `createSemaphore(config.concurrency.maxToolConcurrency)` bounds in-flight
   tool calls. Routes: `GET /health/live`, `GET /health/ready`, `GET /version`,
   and `/mcp` mounted with `edgeMiddleware` then `deadlineMiddleware`.

2. **`src/mcp/transport.ts` → `createMcpTransport`** — `POST /` only.
   `GET` and `DELETE` return 405 JSON-RPC errors, which is correct for the
   stateless design but means SSE-only MCP clients cannot connect. Reads the
   request id from the response header that `edgeMiddleware` set, then
   `createServer(requestId)` → `WebStandardStreamableHTTPServerTransport`
   (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) → `server.connect`.

3. **`src/mcp/registry.ts` → `createRepositoryServer`** — a low-level SDK
   `Server` with handlers for list/call tools, list/read resources, and
   list/get prompts. The tool table is a module-level `const TOOLS` with exactly
   five keys. Each `run` does `schema.parse(args)` (strict zod, unknown keys
   rejected) then dispatches, and returns `{structured, text, links}`. On call:
   `semaphore.tryAcquire()` → `rate_limited` if unavailable; error mapping is
   `ToolFailure` → `code: message`, zod → `invalid_input: …`, anything else →
   the deliberately opaque `backend_unavailable: The request could not be
   completed.` That opacity is intentional — see the indistinguishability
   invariant.

4. **`src/mcp/tools/search-items.ts` → `searchItems(context, input)`** —
   selects repositories, computes a query hash over
   `{query, repositories, field, filters, sort, limit}`, decodes the cursor and
   *resets it with a warning* on hash mismatch, then fans out with
   `Promise.allSettled` so one repository failing yields a partial result rather
   than an error. All-failed → `backendUnavailable()`. Then `mergePages(...)` →
   `assembleResponse(...)`, warnings capped at 10.

5. **`src/adapters/caching.ts` → `withCaching`** — wraps `search` (keyed by a
   stable serialization of the request) and `get` (record cache, revalidated
   through `adapter.probePublic` before emit; a missing probe evicts and
   misses). `facets`, `related`, and `validateSchema` are uncached.

6. **The adapter** (`src/adapters/jscholarship/index.ts`) — `buildSearchQuery`
   against the profile → `SolrClient.execute` (POST form body, `redirect:
   "error"`, wrapped in `withRetry`) → `parseDocs` → `canonicalize`.

7. **The gate** (`src/adapters/canonicalize.ts` → `canonicalizeInOrder`) —
   resolves candidates through the canonical API with bounded look-ahead
   concurrency, **in rank order**, dropping any that resolve to `null`. Order
   matters: the cursor arithmetic `nextOffset = offset + consumed` depends on
   `consumed` being a prefix of the rank order. Attrition is surfaced as a
   `validation_attrition` warning.

8. **The platform client** — `DSpaceClient.resolveItem` returns `null` on
   401/403/404 or when the public gate fails (`type === "item"`, `inArchive`,
   `discoverable`, `!withdrawn`). `DataverseClient.resolveDataset` returns
   `null` on 401/403/404, a malformed persistent id, or `versionState !==
   "RELEASED"`. Only the canonical response is normalized into a record.

9. **Models** (`src/models/factories.ts`) — `createRepositoryRecord` /
   `createItemDetail`, IDs namespaced by `createRecordId`.

10. **Back up** — `mergePages` → `SearchResponse` → registry renders
    `structuredContent` plus a text summary plus resource links → SDK →
    Hono response.

`get_item` short-circuits steps 4–7 and goes straight to the platform client.
Resources (`jhu-repo://…`) parse the URI and call the same `getItem` handler, so
there is exactly one code path to a single record.

## The RepositoryAdapter interface

`src/adapters/index.ts`:

```ts
export interface RepositoryAdapter {
  readonly id: RepositoryId;
  validateSchema(): Promise<SchemaValidationResult>;
  search(request: RepositorySearchRequest): Promise<RepositoryPage>;
  get(identifier: RepositoryIdentifier): Promise<ItemDetail | null>;
  facets(request: RepositoryFacetRequest): Promise<RepositoryFacets>;
  related(source: ItemDetail, request: RelatedRequest): Promise<RepositoryPage>;
  probePublic?(record: RepositoryRecord): Promise<boolean>;
}
```

Note what the interface does **not** do: it does not try to make DSpace and
Dataverse look identical internally. There is no shared `isPublic()`. Each
adapter implements its own platform-specific notion of public, because the
conditions genuinely differ (DSpace: non-withdrawn, discoverable, latest,
archived, anonymous-readable; Dataverse: published, not deaccessioned, latest
published version, no API key needed). Only the *meaning* is shared. This is
ADR-004 and it is the decision to preserve if you extend the system.

Where the two adapters legitimately diverge:

- **Related records.** JScholarship uses Solr MoreLikeThis as a search
  component on `/select` (`mlt=true`); the Solr client refuses any other path.
  Dataverse
  has no MLT configuration, so JHRDR builds a bounded keyword string from
  title + creators + subjects (capped around 400 chars) and runs an ordinary
  keyword search, then filters the source record out.
- **Identity.** JScholarship keys candidates off the Solr uuid field; JHRDR
  keys off the persistent identifier.

## Where each invariant is actually enforced

| Invariant | Enforced in | Notes |
| --- | --- | --- |
| Canonical-API gate | `src/adapters/canonicalize.ts` (`canonicalizeInOrder`) + each platform client's null-return | The only place candidates become records |
| Immutable public filters | `config/repositories/*-profile.ts` (`immutablePublicFilters`), applied in `src/adapters/solr-query.ts` | Not overridable by any input |
| Field allowlist | `config/repositories/*-profile.ts` + `translateFilters`/`buildSearchQuery` in `src/adapters/solr-query.ts` | Unmapped concepts become `unsupported_filter` warnings, never raw Solr |
| Indistinguishable not-found | `src/mcp/tools/get-item.ts` + the opaque `backend_unavailable` mapping in `registry.ts` | Never let an error message distinguish "missing" from "restricted" |
| Namespaced IDs | `src/models/identifiers.ts` (`createRecordId`, `parseRecordId`) | |
| No cross-repo score comparison | `src/federation/index.ts` (`mergePages`) | Reads `sourceRank`, never a score |
| Stateless pagination | `src/federation/index.ts` (`encodeCursor`/`decodeCursor`) | |
| Fail-closed startup | `src/adapters/solr-schema-validator.ts` + `readinessState` in `src/index.ts` | Required fields missing ⇒ `/health/ready` 503 |
| Metadata is data, never instruction | `src/mcp/prompts.ts`, `src/observability/index.ts` | Prompt preamble is not argument-alterable; logs are allowlist-redacted |

## Federation, ranking, and cursors

`src/federation/index.ts`.

- `mergePages(input)` — two-pointer merge over per-repository queues. Score is
  `weight / (RRF_K + sourceRank)` with `RRF_K = 60`. Raw Solr scores are never
  read.
- **Tie-break** — deterministic and alternating. A `preferred` repository (from
  the cursor's `nextTieSource`, defaulting to `jscholarship`) wins ties;
  otherwise the lexicographically smaller namespaced id wins; and after emitting,
  the preference flips. The alternation is what keeps the merge fair across
  pages instead of systematically favoring one repository.
- **Cursor** — `FederatedCursorV1 {v, queryHash, jsOffset, dvOffset,
  nextTieSource}`, canonical-JSON serialized then base64url. `decodeCursor`
  rejects oversized (>2048 chars), non-JSON, wrong version, malformed hash
  (must be 16 hex chars), out-of-range offsets, or unknown tie source. An
  exhausted repository is encoded as offset `-1`.
- **Query hash** — FNV-1a 64-bit over canonical JSON. Binding the cursor to the
  query is what makes a cursor from a different search detectable, and the
  response to that is a reset plus `cursor_reset` warning, not an error
  (ADR-012).

## Configuration and startup

Repository profiles are **static TypeScript literals**, not runtime config:
`config/repositories/jscholarship-profile.ts` and `jhrdr-profile.ts`. They hold
query/filter/facet/sort/related/identity field maps, the immutable public
filters, and the required vs optional Solr schema field lists. Changing what the
service can search means editing a profile and re-running the schema validator —
that deliberate friction is the point.

Environment (`src/config/env.ts`, zod `safeParse`, all issues reported at once).
The generated `docs/reference/configuration.md` is the maintained list with
descriptions; the summary below is for orientation:

Required — startup fails without them: `ENVIRONMENT` (`stage`|`production`),
`BUILD_VERSION`, `BUILD_COMMIT`, `JSCHOLARSHIP_SOLR_URL`, `JSCHOLARSHIP_API_URL`,
`JSCHOLARSHIP_PUBLIC_URL`, `ALLOWED_HOSTS` (comma list, ≥1).

Defaulted: `PORT` 3000, `JHRDR_SOLR_URL` "", `JHRDR_API_URL` "",
`JHRDR_PUBLIC_URL` `https://archive.data.jhu.edu`, `ALLOWED_ORIGINS` "",
`TIMEOUT_SOLR_MS` 5000, `TIMEOUT_API_MS` 5000, `TIMEOUT_DEADLINE_MS` 10000
(clamped ≤30000), `MAX_TOOL_CONCURRENCY` 10, `MAX_CANONICALIZATION_WORKERS` 5,
`CACHE_SEARCH_TTL_MS` 60000, `CACHE_RECORD_TTL_MS` 60000, `CACHE_MAX_ENTRIES`
500, `MAX_BODY_BYTES` 65536.

Startup validation: `performSchemaValidation()` builds fresh uncached adapters
and calls `validateSchema()` → `validateSolrSchema` GETs `/schema/fields` and
`/schema/dynamicfields`, checks `requiredSchemaFields` (missing ⇒ invalid) and
`optionalSchemaFields` (missing ⇒ `missingOptional` + `disabledFeatures`, with
dynamic-pattern matching for `*_mlt`-style fields). Results land in
`readinessState`; `/health/ready` returns 503 until validated. `SIGTERM` flips
readiness off, then exits one request deadline later so in-flight requests can
finish. Note that the deployed container health check and the ALB target group
both probe `/health/live`, not `/health/ready`, so readiness is reported but does
not gate routing.

## Security and observability

`src/security/index.ts` exports `isHostAllowed`, `isOriginAllowed`,
`edgeMiddleware`, `deadlineMiddleware`, `createSemaphore`. `edgeMiddleware`
does Host/Origin validation (DNS-rebinding defense), body-size bounding, and
sets the `x-request-id` header that the transport later reads back. Note that
host checking is **skipped entirely when `ALLOWED_HOSTS` is empty** — which is
why env validation requires at least one entry. When it runs, it compares the raw
`Host` header exactly, port included, so a local client needs
`ALLOWED_HOSTS=localhost:3000`, not `localhost`.

`src/observability/index.ts` — `serializeToolInvocation` is **deny-by-default**:
it constructs the log object field by field from a known set rather than
filtering a payload. That's the right shape for redaction, because the failure
mode of a denylist is silent leakage of a field someone added later.
`serializeBackendFault` does the same for `backend_fault` lines, which give
operators the failing operation, error class, and HTTP status behind an opaque
`backend_unavailable` without any URL, identifier, or message. Free text is
truncated and metadata objects passed to `info`/`warn`/`error` are dropped; metrics go out as CloudWatch EMF (`Calls`, `Errors`, `LatencyMs`,
`ZeroResults`, `PartialResults`, dimensioned by `Tool`). Query strings and
record metadata are not logged.

## Tests

`test/` is organized by kind, and the kinds mean different things here:

- `unit/` — module-level behavior (config, models, schemas, solr-query, resilience)
- `property/` — the invariants as generated cases via `fast-check`, ≥100 cases
  per property. This is where "every emitted Solr field is allowlisted" and
  "namespaced IDs never collide" live. **New invariants belong here.**
- `contract/` — the DSpace and Dataverse clients against recorded fixtures
- `integration/` — the assembled server: transport, registry, tools, plus
  `non-public-disclosure.test.ts` and `excluded-capabilities.test.ts`, which
  are the ones that fail if someone widens the surface
- `fixtures/` — sanitized real payloads, including deliberately
  withdrawn/restricted records. Read `test/fixtures/*/README.md` before adding
  any; never commit an unsanitized payload.

## Deployment and CI

Multi-stage `Dockerfile` (Bun, non-root). `infra/` is OpenTofu with two modules
— `mcp-shared` (IAM, shared ALB, WAF) and `mcp-service` (per-environment ECS
service, networking, observability) — driven by `environments/{stage,prod}.tfvars`.
One MCP service per environment (ADR-001).

`.github/workflows/`: `ci.yml` (install → lint → docs checks → typecheck → test →
build, plus a dependency audit), `build-push.yml`, `deploy.yml`, `infra-validate.yml`,
`smoke-test.yml`, and `docs.yml`, `docs-impact.yml`, `docs-freshness.yml` for the
developer reference site.

For what remains to be built, read the unchecked items in
`.kiro/specs/*/tasks.md` directly rather than relying on a summary.

## Sharp edges worth knowing

Mention these when relevant — they're the things that cost a newcomer an
afternoon. Verify each against current code before asserting it, since some may
have been fixed since this was written.

- **Use `bun install --frozen-lockfile`.** It is what CI and the Dockerfile run.
  `bun ci` is an equivalent alias in the pinned Bun 1.3.11 (it did not exist in
  the previously pinned 1.2.15).
- **`zod-to-json-schema` is imported in `src/mcp/registry.ts` but is not a
  declared dependency** in `package.json`. It resolves transitively today, which
  is fragile.
- **`TIMEOUT_API_MS` / `config.timeouts.canonicalApiMs` is parsed but not read** —
  both platform clients get the Solr timeout. The canonical-API timeout knob
  currently does nothing.
- **The search cache is served without revalidation; the record cache is not.**
  Search entries are pages that already passed canonicalization, bounded by a
  TTL at or below Solr re-index lag; cached records are re-probed via
  `probePublic` before being served. Don't "optimize" the record probe away.
- **`disabledFeatures` is computed and reported but not enforced** — the
  JScholarship `related()` path will still issue a MoreLikeThis query even when the
  schema validator reported those dynamic fields missing.
- **`filters.access` is accepted by the schema and always unsupported** —
  `translateFilters` unconditionally marks it unsupported, so clients get a
  warning rather than an error.
- **`find_related_items` can under-fill**, because the source record is filtered
  out *after* the merge trims to `limit`.
- **`JHRDR_SOLR_URL` / `JHRDR_API_URL` are plain strings, not URL-validated.** A
  malformed non-empty value passes config validation and then throws in the
  adapter constructor at module scope, outside the guarded `loadConfig`.
- **JHRDR's Solr-side `discoverableBy:Anonymous` clause is commented out**
  pending verification, so for JHRDR the canonical `versionState === "RELEASED"`
  check is doing the real work.
- **Readiness does not gate traffic in deployment.** The ECS container health
  check and the ALB target group both probe `/health/live`. A task whose schema
  validation failed still receives requests; only the smoke test checks
  `/health/ready`.
- **Three declared error codes are never emitted.** `deadline_exceeded`,
  `unsupported_parameter`, and `capability_unavailable` exist in `ToolErrorCode`
  but no handler throws them. An overrun deadline is an HTTP 504 JSON-RPC error
  from `deadlineMiddleware`, not a tool error.
- **JHRDR's keyword search includes `_text_`** (boost 1) in `queryFields.keyword`,
  even though the profile's `fulltextDecision.rationale` says that field is kept
  out of the keyword list. Code wins; the rationale text is stale.

## Common change recipes

**Add a searchable field or filter.** Add the concept to the relevant
`config/repositories/*-profile.ts` allowlist *and* to `requiredSchemaFields` or
`optionalSchemaFields`; extend `translateFilters` in `src/adapters/solr-query.ts`;
extend the zod input schema in `src/models/schemas.ts`; add a property test
proving the emitted field stays allowlisted. Run the schema validator against a
real Solr before assuming the field exists in the deployed index. Then run
`bun run docs:generate`: the repository capability tables in
`docs/reference/repositories.md` are produced by running each concept through
the real query builder, and CI fails until they are regenerated.

**Add a tool.** This is a scope change, not just a code change — the registry is
a closed table by design (Requirement 17, ADR-008). Update the spec first, then
add `src/mcp/tools/<name>.ts`, a strict zod input/output schema with
`additionalProperties: false`, an entry in `TOOLS` with a text renderer, and an
integration test. `test/integration/excluded-capabilities.test.ts` exists
specifically to fail when the surface grows, so expect to update it deliberately.
Regenerate the docs (`bun run docs:generate`) so `docs/reference/mcp-surface.md`
and the injected tool tables in `README.md` and `CLAUDE.md` pick it up, and
update `EXPECTED_TOOLS` in `scripts/smoke-test.sh`.

**Add a third repository.** Implement `RepositoryAdapter` in a new
`src/adapters/<id>/` with its own platform client and public gate; add a profile
under `config/repositories/`; add the id to `RepositoryId` and the namespacing
in `src/models/identifiers.ts`; then extend `src/federation/index.ts` — and note
that the cursor is currently a two-repository shape (`jsOffset`/`dvOffset`) and
the tie-break alternates between exactly two sources. That cursor version bump
is the real work; `.kiro/specs/n-repository-federation/` covers generalizing it,
so read it before starting.

**Change a public-access rule.** Change the profile's immutable filters *and*
the platform client's public gate together, add a fixture for the newly
excluded case in `test/fixtures/`, and extend
`test/integration/non-public-disclosure.test.ts`. Never change one of the two
layers alone. Then regenerate the docs: the public-access rules listed in
`docs/reference/repositories.md` come from the profile's filter descriptions.

**Change configuration or error codes.** A new environment variable needs a
description in `scripts/docs/generators/configuration.ts`, and a new
`ToolErrorCode` or warning code needs one in `scripts/docs/generators/errors.ts`.
Both are `Record`s keyed by the code's own types, so `bun run typecheck` fails
until you add them.

**Change behavior a hand-written doc describes.** Pages under
`docs/architecture/` and `docs/guides/` list the files they describe in
`sources:` front matter. The PR gets an advisory comment naming the affected
pages; re-read each against the code, fix it, and set `verified:` to today.
Pages describe the system as built: no task numbers, plans, or progress notes.
