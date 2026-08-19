# Building another MCP server on these bones

Use this when someone wants to build a *different* MCP server modeled on
`jhu-repository-mcp` — another repository federation, a different set of
backends, a similar read-only discovery service over systems that have their own
access rules.

The value here is not the file layout. It's a set of decisions that were made
deliberately, each with a reason and a cost. Copying the layout without the
reasoning produces something that looks like this server and doesn't hold the
guarantees. So for each pattern below: the shape, why it exists, what it costs,
when it doesn't apply, and where to read the worked example in this repo.

Before anything else, ask what the new server's **hard guarantee** is. This
codebase's is "never disclose a non-public record, and never let a client infer
one exists." Almost every pattern below is downstream of that. If the new
server's guarantee is different — freshness, cost, tenant isolation, auditability
— the same techniques apply but the emphasis shifts, and copying the emphasis
blindly is how you end up with ceremony that protects nothing.

---

## 1. Fast index for candidates, authoritative source for truth

**Shape.** Query a fast index (Solr, Elasticsearch, a materialized view, a
vector store) to *find* things, then re-fetch every result you intend to return
through the system of record, as the caller's own privilege level. Anything that
fails the re-fetch is dropped silently. Nothing from the index is ever projected
into the response.

**Why.** Indexes lag, and their copies of access-control fields drift from what
the source system enforces. That drift is invisible until the day it isn't. The
re-fetch converts a correctness question ("is the index's ACL copy current?")
into a much easier one ("does the source system serve this to this caller?").

**Cost.** N+1 network calls per page, and result attrition — you asked for 10
candidates and got 7 records. Both are manageable: bound the look-ahead
concurrency, resolve in rank order, and surface attrition as a warning rather
than silently returning short pages.

**Doesn't apply when** the index *is* the system of record, or when nothing in
the corpus is access-controlled.

**Worked example.** `src/adapters/canonicalize.ts` (`canonicalizeInOrder`), plus
the null-returning public gates in `src/adapters/*/[dspace|dataverse]-client.ts`.
Note the in-rank-order requirement: cursor arithmetic depends on consumed
candidates forming a prefix.

## 2. Per-backend adapter behind a thin interface — that doesn't force uniformity

**Shape.** One interface (`search`, `get`, `facets`, `related`, `validateSchema`,
optional `probePublic`), implemented once per backend. Backend field names, URL
construction, and access semantics live below the seam; nothing above it knows
the backends exist.

**Why.** The temptation is to define a shared `isPublic()` and have each backend
fill it in. Resist it. DSpace's notion of public (non-withdrawn, discoverable,
latest, archived, anonymous-readable) and Dataverse's (published, not
deaccessioned, latest published version, no API key) are genuinely different
predicates over different data. Forcing a shared implementation means the
abstraction lies, and the lie surfaces as a disclosure bug. Share the
*meaning*, not the code.

**Cost.** Some duplication between adapters. Accept it — duplication between two
correct backend-specific gates is cheaper than one shared gate that's subtly
wrong for one backend.

**Worked example.** `src/adapters/index.ts` for the interface; ADR-004 for the
reasoning; the two `related()` implementations for legitimate divergence
(JScholarship uses Solr MoreLikeThis, JHRDR synthesizes a bounded keyword query
because Dataverse has no MLT config).

## 3. Allowlist-shaped configuration, checked against reality at startup

**Shape.** A per-backend profile declares every field the service may touch —
query fields with boosts, filterable fields, facetable fields, sorts, identity
fields — plus non-overridable filter clauses appended to every query. Required
vs optional fields are distinguished. At startup, the service asks each backend
for its actual schema and refuses readiness if a required field is missing;
missing optional fields disable specific features and are reported.

**Why.** Three things at once. The allowlist means there is no raw query
passthrough, so client input can never reach the backend's query language. The
immutable filters are a cheap first line before the expensive canonical gate.
And the startup check turns "the index was reconfigured last night" from a
silent behavior change into a failed deployment.

**Cost.** Adding a searchable field is a code change plus a re-verification,
not a config tweak. That friction is the feature.

**Watch for.** Computing `disabledFeatures` and then not enforcing it — this
repo does exactly that, and it's the pattern's easiest failure mode. If a
feature is reported disabled, the code path for it should actually refuse to
run.

**Worked example.** `config/repositories/*-profile.ts`,
`src/adapters/solr-query.ts`, `src/adapters/solr-schema-validator.ts`, and the
`readinessState` wiring in `src/index.ts`.

## 4. Stateless transport, all continuation state in an opaque signed-ish cursor

**Shape.** MCP Streamable HTTP with no session id and JSON responses; POST only.
Every bit of pagination state — per-backend offsets, a hash of the query that
produced the cursor, the next tie-break source — is encoded into a versioned,
length-bounded, base64url token. Decoding validates the version, the hash
format, offset ranges, and every enum before trusting anything.

**Why.** Horizontal scaling with no session affinity: any task serves any
request, and a deploy mid-pagination is a non-event. The query hash is what
makes a cursor from a *different* query detectable.

**Cost.** No server-side result caching keyed by session, and the cursor grows
with the number of backends. Note that this repo's cursor has a two-backend
shape (`jsOffset`/`dvOffset`) and a two-way tie-break — generalize that from
the start if you expect more than two.

**The subtle part.** On hash mismatch, **reset to page 1 with a warning rather
than erroring** (ADR-012). Your consumer is a language model, and an error at a
pagination boundary reliably produces a retry loop; a reset plus an honest
warning produces a model that continues and tells the user what happened.
Designing error semantics for a model consumer rather than a human one is worth
doing consciously throughout.

**Worked example.** `src/federation/index.ts` (`encodeCursor`, `decodeCursor`,
`buildNextCursor`, `computeQueryHash`), `src/mcp/transport.ts`, ADR-006.

## 5. Rank fusion, never score comparison

**Shape.** When merging results from independent backends, discard raw relevance
scores at the adapter boundary and keep only each result's ordinal rank within
its own backend. Merge with reciprocal-rank fusion (`weight / (k + rank)`,
k = 60), and break ties deterministically by *alternating* the preferred source,
carrying the next preference in the cursor.

**Why.** Scores from different engines, corpora, and field-boost configurations
are not commensurable. Comparing them yields an ordering that is stable,
confident, and meaningless. RRF needs only rank, which is comparable by
construction. And a *fixed* tie-break systematically favors one backend page
after page — an invisible editorial bias in something users read as neutral.

**Cost.** You lose genuine within-backend score magnitude, so a result that was
overwhelmingly the best match in its backend is merged as merely rank 1. Per-
backend weights are the knob for that.

**Worked example.** `src/federation/index.ts` (`mergePages`), ADR-007.

## 6. A closed capability registry

**Shape.** Tools, resources, and prompts live in a static table. Every input and
output schema is strict (`additionalProperties: false`, bounded strings, arrays,
and nesting). No dynamic tool creation. A test exists whose entire job is to
fail when the surface grows.

**Why.** Every tool is attack surface against your hard guarantee, and MCP makes
adding one trivially easy. Making the registry closed forces expansion to be a
deliberate, spec-level decision instead of a Tuesday afternoon.

**Cost.** Friction on legitimate additions — which is the point, but say so out
loud so it reads as design rather than obstruction.

**Worked example.** `src/mcp/registry.ts` (the `TOOLS` const),
`src/models/schemas.ts`, `test/integration/excluded-capabilities.test.ts`,
ADR-008.

## 7. The host model does the synthesis

**Shape.** Return structured, citation-ready records and a plain text rendering.
Do not summarize, do not embed an LLM, do not do semantic reranking inside the
server.

**Why.** A server that only projects verified data has a guarantee you can
actually test: every field in every response traces to a canonical fetch.
Introduce generation and that becomes untestable — you'd be verifying that a
model didn't paraphrase a restricted abstract it was shown. It also keeps the
server cheap, fast, and deterministic, and lets the host model use its own
context.

**Cost.** More tokens over the wire, and the quality of the final answer depends
on a model you don't control.

**Worked example.** ADR-009; the text renderers in `src/mcp/registry.ts`, which
are formatting, not summarization.

## 8. Treat all backend content as untrusted data

**Shape.** Record metadata — titles, abstracts, author names — is user-submitted
content from systems you don't control. It never goes into a prompt or
instruction role, prompt preambles are not alterable by tool arguments, and logs
are built by **allowlist** (construct the log object field by field from known
keys) rather than by denylist.

**Why.** Prompt injection through indexed metadata is a real vector for any
server that hands external content to a model. And the failure mode of a
redaction denylist is silent: someone adds a field, nobody adds it to the
denylist, it leaks. An allowlist fails closed — a new field is simply absent
until someone adds it deliberately.

**Worked example.** `src/observability/index.ts` (`serializeToolInvocation`),
`src/mcp/prompts.ts` (`PROMPT_RULES_PREAMBLE`).

## 9. Fail closed, everywhere, including at the edges

**Shape.** Timeouts, validation failures, and schema mismatches produce omission
or an error, never unvalidated data. Config validation is fail-fast at startup
and reports *all* problems at once. Readiness is gated on backend schema
validation. A concurrency semaphore bounds in-flight work and sheds load as
`rate_limited`. Host/Origin validation and body-size bounds sit at the edge.
`SIGTERM` flips readiness off *before* exiting, so the load balancer drains.
Client-visible errors are deliberately opaque, so failures never distinguish
"missing" from "not permitted."

**Cost.** More 503s, and a service that refuses to start on misconfiguration.
For a read-only discovery service that's the right trade: unavailable is
recoverable, disclosed is not.

**Worked example.** `src/config/env.ts`, `src/security/index.ts`,
`src/index.ts` (readiness and shutdown), the error mapping in
`src/mcp/registry.ts`.

## 10. Encode the invariants as property tests

**Shape.** For each guarantee, a generated-input property test with ≥100 cases:
every emitted backend field is allowlisted; unsafe query syntax cannot change
query structure; namespaced IDs never collide; the merge is deterministic;
redaction never emits an unexpected key. Separately, contract tests pin each
backend client against recorded, sanitized fixtures — including deliberately
non-public records.

**Why.** Example-based tests check the cases you thought of, which are exactly
the cases you already handled. Invariants are universal claims and deserve
universal-ish tests. When you can state a guarantee in one sentence, it should
be one property.

**Worked example.** `test/property/`, `test/contract/`,
`test/integration/non-public-disclosure.test.ts`,
`test/fixtures/*/README.md` for the sanitization rules.

---

## If you're actually scaffolding one

Rough order, mirroring how this repo was built (`.kiro/specs/…/tasks.md`):

1. **Spike the backends first.** Verify the real deployed schema fields, the
   actual access-control values, and network routes against known public *and*
   non-public records. Everything downstream is provisional until this is done —
   this repo made it task 1 for good reason, and its findings live in
   `docs/spike/`.
2. Scaffold: strict TypeScript, pinned runtime, committed lockfile, lint,
   format, and a real `tsc --noEmit` step separate from the bundler.
3. Domain models and strict schemas, with namespaced identifiers from day one.
   Retrofitting namespacing after IDs are in the wild is painful.
4. Backend profiles and startup schema validation.
5. The safe query layer (allowlist + escaping) — with property tests before the
   adapters, so the adapters are built against a checked foundation.
6. One backend end to end: client, public gate, adapter, canonical resolution.
   Ship the single-backend case before federating.
7. The second backend. Resist making it fit the first one's shape.
8. Federation, ranking, cursors.
9. The tools, one at a time, each with a strict schema and an integration test.
10. Transport, then resilience (timeouts, retries, bounded caches, concurrency),
    then observability with allowlist redaction.
11. Container, infrastructure, CI, staged rollout.

Write the ADRs as you go, not afterward. This repo's twelve are the reason its
architecture is explicable a year later, and they're what made writing this
document possible.
