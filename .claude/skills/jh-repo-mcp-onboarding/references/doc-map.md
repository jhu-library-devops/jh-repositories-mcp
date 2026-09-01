# Documentation map and known drift

This repo carries more documentation than code, from several tools with
different lifecycles (Kiro specs, ADRs, agent-instruction files, spikes). Knowing
which one answers which question — and which ones have gone stale — saves a lot
of confused reading.

## Precedence

When sources disagree: **source code > ADRs > Kiro spec > root instruction files
(`CLAUDE.md`, `AGENTS.md`)**. The instruction files are the ones that rot
fastest, because nothing fails when they're wrong.

## What each source is authoritative for

| Path | Authoritative for | Read it when |
| --- | --- | --- |
| `src/`, `config/`, `test/` | What the system actually does | Always, for behavior questions |
| `docs/adr/` (12 ADRs, MADR format) | **Why** a structural choice was made, and what it cost | Someone asks "why is it like this" or proposes reversing a decision |
| `.kiro/specs/jscholarship-jhrdr-mcp/requirements.md` | Numbered acceptance criteria (Requirements 1–17) + the authoritative glossary | You need to know whether a behavior is required or incidental |
| `.kiro/specs/jscholarship-jhrdr-mcp/design.md` | The intended architecture, component interfaces, the 15 correctness properties, rollout phases | Deep design questions; the property list is what `test/property/` implements |
| `.kiro/specs/jscholarship-jhrdr-mcp/tasks.md` | Dependency-ordered build plan (1–26) with completion state | "What's left to build" / picking up work |
| `CONTEXT.md` | Domain language — the terms to use and the ones to avoid | Early, and whenever naming something |
| `docs/spike/` | Verified real-world facts about the deployed DSpace/Dataverse Solr schemas and routes | Before assuming a Solr field exists |
| `test/fixtures/*/README.md` | Provenance and sanitization rules for fixtures | Before adding any fixture |
| `.kiro/steering/` | Team standards: TypeScript formatting, error handling, logging, security, testing | Writing code, especially error handling and logging |
| `.claude/` | Agent configuration — the `kfc` spec-workflow subagents, system prompts, and this skill under `.claude/skills/` | Working out how the spec workflow is driven |
| `CLAUDE.md` | Orientation for AI agents: current state, invariants, commands, conventions | Starting any task in the repo |
| `AGENTS.md` | Same role, different tool — style, testing, and PR guidance | With skepticism about repo state; see below |
| `infra/`, `.github/workflows/` | Deployment and CI reality | Deployment questions |

## The ADRs at a glance

All accepted. Cite them by number when explaining a decision; each has the
context and consequences that a one-line summary loses.

| ADR | Decision |
| --- | --- |
| 001 | One MCP service per environment |
| 002 | Pinned Bun release with strict TypeScript |
| 003 | Hono with the MCP SDK Web Standard Streamable HTTP transport |
| 004 | Two platform-specific adapters behind one interface |
| 005 | Direct private Solr for candidates, canonical API for every returned record |
| 006 | Stateless MCP Streamable HTTP with JSON responses |
| 007 | Repository-local relevance plus balanced reciprocal-rank merge |
| 008 | Anonymous read-only v1 access model |
| 009 | Host model performs synthesis |
| 010 | New cross-repository service stack |
| 011 | Search cache never bypasses the canonical API gate |
| 012 | Cursor hash mismatch resets pagination instead of returning an error |

ADR-005 is the one to read first. It is the architecture.

## Known drift

Verified at the time this skill was written. **Re-check before asserting any of
it** — some may have been fixed, and a confident wrong claim about the docs is
worse than no claim. When you confirm drift, say so explicitly to whoever you're
onboarding; the habit of noticing it is part of what you're teaching.

**`AGENTS.md` still assumes the repo is spec-only** ("does not yet contain
application code or a package manifest"). That was true once and isn't now —
`src/`, `package.json`, and the test suite all exist. Its style, testing, and PR
guidance is otherwise accurate, and its build commands are the correct ones.
(`CLAUDE.md` carried the same assumption until it was rewritten; it is current
as of this skill's writing, so read it as a description rather than a plan.)

**`bun ci` is not a real Bun command.** It appears in the Dockerfile. The
working command is `bun install --frozen-lockfile`, which is what `AGENTS.md`,
`CLAUDE.md`, and `.github/workflows/ci.yml` use.

**`CONTEXT.md` and `src/adapters/caching.ts` describe different caching.** The
glossary dialogue says the search cache stores Candidates that are always
re-validated before becoming SearchResults. In the code, the search cache stores
already-validated `RepositoryPage` objects and serves them without
re-validation; only the *record* cache re-validates, through `probePublic`. Both
are consistent with ADR-011's intent (nothing bypasses the gate — the cached
page went through it), but the doc's mechanism is not the code's mechanism.

**Two stale `TODO: Implement as Hono middleware (task 16.4)` comments** in
`src/security/index.ts` sit above the already-implemented middleware.

**`tasks.md` says zod v4; `package.json` pins the `^3.25` line.** Worth
confirming which the code actually imports before repeating either.

**Some `Requirements: N.N` comments in `src/` and design-section references in
`src/federation/index.ts`** point into the Kiro spec. Those files do exist —
follow the reference rather than assuming it's dangling.

**`config/repositories/jhrdr-endpoints.ts` is a self-declared stub** with
placeholder security-group values, and JHRDR's Solr-side
`discoverableBy:Anonymous` filter clause is commented out pending verification.
Both are known-provisional, not bugs to "fix" without checking the spike docs in
`docs/spike/` first.

## How to handle drift when you find new instances

Say what you found, name the file, state what the code does instead, and offer
to fix the doc — but don't rewrite spec files as a side effect of answering an
unrelated question. The Kiro spec files cross-reference each other by
requirement number; changing one without the others creates worse drift than it
removes.
