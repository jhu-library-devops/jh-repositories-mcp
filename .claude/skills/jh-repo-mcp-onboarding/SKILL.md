---
name: jh-repo-mcp-onboarding
description: Onboard a developer into the jhu-repository-mcp codebase (the JScholarship/JHRDR federated MCP server) and serve as its architecture reference. Use this whenever someone is new to this repo, is orienting themselves in it, or asks things like "how does this codebase work", "walk me through this project", "where do I start", "how does search actually work here", "what's the adapter pattern here", "how do I add a tool / a repository / a filter", "why does it do X", "what do these ADRs mean" — and also whenever anyone wants to build a new MCP server modeled on this one ("build another MCP like this", "reuse this architecture", "scaffold a similar federated server"). Use it even when the question looks like a narrow one-file question, because the invariants in this codebase are cross-cutting and answering from one file alone tends to be wrong. Do not use it for unrelated repositories.
---

# Onboarding to jhu-repository-mcp

This skill exists because this codebase is easy to misread. It looks like a
straightforward search API, but almost every module is shaped by security
invariants that are not local to the file you happen to be reading. A developer
who learns the modules without learning the invariants will write code that
passes review-by-eyeball and quietly leaks non-public records. Your job is to
transmit the invariants, not just the file tree.

## What this project is, in one paragraph

`jhu-repository-mcp` is a read-only Model Context Protocol server that lets an
AI assistant search and cite two independently operated Johns Hopkins
repositories through a single federated interface: **JScholarship** (DSpace,
indexed by a SolrCloud `search` collection, resolved through DSpace REST) and
**JHRDR**, the Johns Hopkins Research Data Repository (Dataverse, indexed by
Solr `collection1`, resolved through the Dataverse Native API). It runs on Bun
with Hono and the official MCP TypeScript SDK's Web Standard Streamable HTTP
transport, deployed as ECS Fargate tasks. v1 is deliberately narrow: anonymous,
read-only, no embedded LLM, no vector search, no writes, no file-content
proxying.

## Route first

Three audiences need genuinely different things. A person shipping a bug fix
does not need Dataverse version-state semantics; a person building a sibling
server does not need this repo's deployment story.

| They are here to… | Do this |
| --- | --- |
| Get oriented as a new team member | Run the walkthrough — **read `references/walkthrough.md` before you reply** |
| Work on something specific | Read `references/architecture.md`, then answer against the code, citing files |
| Build another MCP like this one | Use `references/mcp-patterns.md` |
| Understand a decision ("why is it like this?") | `references/doc-map.md` routes you to the ADR or spec section |

### If it's the walkthrough, the shape of your first reply matters more than its content

"Walk me through this codebase" pulls hard toward producing a comprehensive
written guide — every stage, every file, checkpoint questions with the answers
supplied below them. That artifact is worse than useless for onboarding: it
gets skimmed, nothing is retained, and you learn nothing about what confused
them. A tour is turn-taking or it isn't a tour.

So on first contact, your reply is **short** — a few sentences on what the
project is and the one constraint that shapes it, a light mention that you can
write it up as a doc instead if they'd rather, and one question whose answer
changes where you begin. Then stop. Short but not empty: someone who asked for a
tour should get the start of one, not a menu of options.
`references/walkthrough.md` has the wording and the five stages that follow;
read it before replying, because the sequencing and the checkpoint questions are
the substance of the thing.

Two rules that survive into every later message: one stage per message, ending
with a question, and **never answer your own checkpoint question**. The answer
they give is the only diagnostic you get, and supplying it throws that away.

If they explicitly ask for a written reference instead, give them one — cover
the same stages in a single pass. Don't force Socratic method on someone who
asked for a document.

The stages are a default path, not a track. When someone challenges the
architecture, skips ahead to the thing they actually need, rabbit-holes, or goes
quiet, the tour has stopped being useful and steering them back is the wrong
instinct — `references/walkthrough.md` has a section on reading which kind of
departure it is and what each one calls for.

## The two rules that govern how you read this codebase

**Code is ground truth; docs are intent.** This repo carries a lot of
documentation from several tools with different lifecycles — Kiro specs, ADRs,
agent-instruction files, spike notes — and the instruction files rot fastest
because nothing fails when they're wrong. When a document and the source
disagree, believe the source, say out loud that you found the drift, and name
the file. Silently "correcting" it in your head leaves the next person to
rediscover it. `references/doc-map.md` has the precedence order and the drift
known when this skill was written; treat that list as a starting point rather
than a guarantee, and verify before you assert.

**Never answer a question about behavior from a single file.** The
public-access guarantee is enforced in at least four places (immutable Solr
filters in the profile, the canonical-API gate in the adapter, the public gate
inside each platform client, and the not-found shaping in the tool layer). A
change that looks safe in one of them can defeat another. When you explain or
modify behavior, trace it end to end — `references/architecture.md` gives you
the hop-by-hop path so this is cheap.

## The invariants, and why each exists

These are the things a new developer must be able to state back to you. If they
can, they can be trusted with the code; if they can't, more file-tour will not
help.

**Solr finds candidates; the canonical API decides truth.** Every search hits a
private Solr collection for fast candidate retrieval, but no Solr-sourced
metadata is ever returned to a client. Each candidate is re-fetched through the
platform's own public API (DSpace REST / Dataverse Native), and one that fails
that fetch is silently dropped. *Why:* the Solr indexes are internal and their
access fields have historically drifted from what the platforms actually
enforce. Trusting Solr means eventually publishing a withdrawn thesis.

**Immutable public filters cannot be weakened by any input.** Each repository
profile bakes in non-overridable filter clauses (non-withdrawn / discoverable /
latest / archived for DSpace; published / non-draft / non-deaccessioned for
Dataverse). *Why:* defense in depth behind the canonical gate — and cheaper,
since most non-public records never become candidates at all.

**Field allowlists only; there is no raw Solr passthrough.** Every query field,
filter, sort, facet, and related-record field is mapped through a per-repository
allowlist. *Why:* an escape hatch to raw Solr syntax is an escape hatch around
the immutable filters.

**Not-found is indistinguishable.** A nonexistent identifier and a real but
non-public one return the identical shape. *Why:* otherwise the server is an
oracle for probing whether embargoed content exists.

**Record IDs are namespaced by repository.** `jscholarship:<uuid>` and
`jhrdr:<persistent-id>`. *Why:* two platforms, two ID spaces, and a collision
would resolve a citation to the wrong record.

**Scores are never compared across repositories.** DSpace and Dataverse Solr
scores are not commensurable. Each adapter keeps its own ordinal rank, and
federation merges by balanced reciprocal-rank fusion with deterministic
tie-breaks. *Why:* comparing them produces confident, stable, wrong ordering.

**Pagination is stateless.** All paging state lives in an opaque versioned
cursor, so any Fargate task can serve any request. A cursor whose query hash
doesn't match resets to page 1 with a warning rather than erroring. *Why:* an
error here puts the host model into a retry loop; a reset lets it continue.

**Everything fails closed.** Timeout, validation failure, schema mismatch — all
produce omission or an error, never unvalidated data. Startup fails readiness if
required Solr schema fields are missing (optional ones degrade with a recorded
`disabledFeatures` list instead).

**Record metadata is untrusted data.** Titles and abstracts come from user
submissions. They are never interpolated into a prompt or instruction role.

## Verify their setup, don't just describe it

An onboarding that ends with "and then you run `bun test`" is how people
discover on day three that their toolchain was broken on day one. Walk them
through actually running it, in this order, and stop at the first failure:

```bash
bun install --frozen-lockfile   # honors .bun-version and the committed bun.lock
bun run typecheck               # tsc --noEmit; Bun's bundler does not type-check
bun test                        # unit, property, contract, integration
bun run lint                    # biome check .
```

`bun run dev` needs environment variables or it exits immediately by design —
config validation is fail-fast. `references/walkthrough.md` has the minimum
viable env set and the two health endpoints to hit. If a step fails, treat that
as the more useful onboarding moment: the failure usually teaches the
fail-closed philosophy better than the prose does.

## When they change something

Two habits worth installing early, both of which this repo's history enforces:

Tests are not optional here and the property tests are the interesting ones —
they encode the invariants above as generated cases (every emitted Solr field is
allowlisted; unsafe query syntax cannot change query structure; namespaced IDs
never collide). If a change touches an invariant, the property test is where it
belongs, and it must run at least 100 generated cases.

Changes are described in `changelog.d/` fragments (`bun run changelog:new`),
not by hand-editing `CHANGELOG.md`, and pull requests are expected to cite the
requirement and task numbers they advance. Those numbers are the connective
tissue between `.kiro/specs/jscholarship-jhrdr-mcp/{requirements,design,tasks}.md`
and the code comments that reference them.

## Reference files

Read these as needed rather than upfront:

- `references/walkthrough.md` — the staged guided tour, with checkpoints and the
  environment-verification steps. Use for a genuinely new developer.
- `references/architecture.md` — module map, the end-to-end request path with
  real function names, and where each invariant is enforced. Use when answering
  any "how does X work" or before modifying anything.
- `references/doc-map.md` — every documentation source in the repo, what it is
  authoritative for, and the known drift. Use when a doc and the code disagree,
  or when asked "why was this decided".
- `references/mcp-patterns.md` — the transferable architecture, stated as
  patterns with rationale and this repo's code as worked examples. Use when
  someone wants to build a different MCP server on the same bones.
