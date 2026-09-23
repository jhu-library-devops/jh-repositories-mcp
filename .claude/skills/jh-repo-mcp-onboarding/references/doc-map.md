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
| `.claude/skills/` | This skill — the only committed part of `.claude/`. Agents, system prompts, and settings under `.claude/` are gitignored and per-developer | Working out what agent configuration ships with the repo |
| `ONBOARDING.md` | Human-facing setup guide: toolchain, installing this skill (project, `--add-dir`, personal, Claude.ai), and using it to build a sibling server | Someone asks how to install or share this skill |
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

**Resolved in the onboarding-guide change** (listed so you don't re-report
them): `AGENTS.md` describing the repo as spec-only; `bun ci` in the Dockerfile,
ADR-002, `design.md`, and `tasks.md` (it doesn't exist in the pinned Bun
1.2.15); `CONTEXT.md`'s search-cache description; the stale task 16.4 TODOs in
`src/security/index.ts`; `tasks.md` naming zod v4 (the code imports zod 3); and
`CONTRIBUTING.md` pointing at the gitignored `.claude/agents/`. If one of these
reappears, it's a regression — say so.

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
