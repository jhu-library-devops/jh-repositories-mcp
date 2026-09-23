# Onboarding

A practical guide for new contributors to `jh-repositories-mcp`, and for anyone
who wants to build a new MCP server using this one as a model. It covers three
things:

1. [Getting the service running](#1-get-it-running) on your machine
2. [Installing the onboarding skill](#2-install-the-onboarding-skill) so Claude
   Code can explain this codebase accurately
3. Using that skill to [learn and discuss the codebase](#3-discuss-the-codebase)
   or to [build a new MCP server](#4-build-a-new-mcp-server-with-it)

If you only read one other file, make it
[ADR-005](docs/adr/ADR-005-solr-candidates-canonical-api-gate.md). The rest of the
design follows from it.

---

## What you're joining

This is a read-only [Model Context Protocol](https://modelcontextprotocol.io)
server. It gives AI research assistants one search interface over two separately
operated Johns Hopkins repositories:

| Repository | Platform | Candidate index | Source of truth |
| --- | --- | --- | --- |
| **JScholarship** (theses, articles, reports) | DSpace | SolrCloud `search` | DSpace REST |
| **JHRDR** (research datasets) | Dataverse | Solr `collection1` | Dataverse Native API |

It's written in strict TypeScript on Bun, uses Hono and the MCP SDK's Web Standard
Streamable HTTP transport, and runs as ECS Fargate tasks.

One rule shapes the whole design. **The server must never disclose a record that
isn't public, and must never let a client infer that such a record exists.**
Solr is used only to find candidates. The platform's public API decides what is
real and public. Most of what looks over-engineered here exists to protect that
rule, so read the invariants in [`CLAUDE.md`](CLAUDE.md#core-architectural-invariants)
before you change any behavior.

---

## 1. Get it running

### Prerequisites

- **Bun `1.2.15`**, pinned in [`.bun-version`](.bun-version). Other versions may
  work, but CI uses this one.
- **Git**, and access to this repository.
- **Claude Code** ([install docs](https://code.claude.com/docs/en/setup)), for
  the skill in section 2. It's optional for the toolchain, but it's the fastest
  way to learn the code.

### Install, check, test

Run these in order and stop at the first failure:

```bash
bun install --frozen-lockfile   # honors .bun-version and the committed bun.lock
bun run typecheck               # tsc --noEmit (Bun's bundler strips types without checking them)
bun test                        # unit, property, contract, integration
bun run lint                    # biome check .
```

Don't substitute `bun ci`. Newer Bun releases have it, but the pinned 1.2.15
doesn't and fails with `error: Script not found "ci"`.

### Start the server

```bash
bun run dev
```

**The server will exit right away** and print every missing environment variable
together. That's intended: config validation fails fast and reports all problems
at once. To keep the process running without real backends, set the minimum:

```bash
ENVIRONMENT=stage BUILD_VERSION=dev BUILD_COMMIT=local \
JSCHOLARSHIP_SOLR_URL=http://localhost:8983/solr/search \
JSCHOLARSHIP_API_URL=http://localhost:8080/server/api \
JSCHOLARSHIP_PUBLIC_URL=https://jscholarship.library.jhu.edu \
ALLOWED_HOSTS=localhost \
bun run dev
```

Then check both health endpoints:

```bash
curl -i http://localhost:3000/health/live    # 200: the process is up
curl -i http://localhost:3000/health/ready   # 503: nothing to validate against
```

The readiness endpoint returns 503 because the service won't take traffic until
it confirms that each Solr index still has the fields its repository profile
requires. Leaving the three `JHRDR_*` variables unset is normal. The JHRDR adapter
is only created when all three are set, so the server runs with JScholarship
alone. The full variable list and defaults are in
[`src/config/env.ts`](src/config/env.ts).

> The default port is 3000. Set `PORT` to use a different one.

---

## 2. Install the onboarding skill

The repo includes a [Claude Code skill](https://code.claude.com/docs/en/skills)
at [`.claude/skills/jh-repo-mcp-onboarding/`](.claude/skills/jh-repo-mcp-onboarding/SKILL.md).
A skill is a folder of instructions that Claude loads when a request matches its
description. This one does three jobs:

- a **guided tour** for new team members, one stage at a time
- an **architecture reference** that traces behavior end to end rather than from
  one file
- a **pattern guide** for building a different MCP server on the same design

```
.claude/skills/jh-repo-mcp-onboarding/
├── SKILL.md                    routing, the invariants, and how to read the repo
└── references/
    ├── walkthrough.md          the staged tour, with checkpoint questions
    ├── architecture.md         module map, request path, where each invariant lives
    ├── doc-map.md              which document answers which question, and known drift
    └── mcp-patterns.md         ten reusable patterns for building a sibling MCP server
```

Pick the setup that matches what you're doing.

### Option A: Working in this repo (nothing to install)

The skill is a **project skill**. It's committed under `.claude/skills/`, so
Claude Code finds it automatically when you start a session in this repository.

```bash
git clone https://github.com/jhu-library-devops/jh-repositories-mcp.git
cd jh-repositories-mcp
claude
```

The first time you open the directory, Claude Code asks whether you trust the
workspace. It won't load anything under `.claude/`, including this skill, until
you accept. To check that the skill loaded, type `/jh-repo` and see whether
`/jh-repo-mcp-onboarding` appears in the autocomplete. You can also ask "which
skills do you have?". You can use it in two ways:

- **Just ask.** Requests like "walk me through this codebase" or "how does
  pagination work here?" match the skill's description, so Claude loads it on
  its own.
- **Call it directly** with `/jh-repo-mcp-onboarding`, optionally followed by
  your question.

This also works in [Claude Code on the web](https://claude.ai/code). When you
start a session on this repository, the committed skill is available. This guide
was written in one of those sessions, and the skill was loaded.

### Option B: From another project (recommended: `--add-dir`)

To build a new MCP server in a **different** repository, Claude needs two things
from this one: the skill, and the source files it cites as worked examples, such
as `src/adapters/canonicalize.ts` and `src/federation/index.ts`. Adding your
clone as an extra working directory gives it both. Claude Code loads
`.claude/skills/` from directories added with `--add-dir`, and it can read their
files.

```bash
cd ~/code/my-new-mcp
claude --add-dir ~/code/jh-repositories-mcp
```

Settings, hooks, and agents from the added directory are **not** loaded. Only
the skill and the files come across, which is what you want here.

**Optional: make it available everywhere.** If you want the skill in every
session without passing `--add-dir`, symlink it into your personal skills
directory. Run this from the root of your `jh-repositories-mcp` clone:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/.claude/skills/jh-repo-mcp-onboarding" ~/.claude/skills/jh-repo-mcp-onboarding
```

A symlink stays current when you `git pull`. A `cp -R` copy doesn't. Keep in
mind that without `--add-dir`, the skill can describe the patterns but can't
open or cite the code behind them. To uninstall, run
`rm ~/.claude/skills/jh-repo-mcp-onboarding`. This removes the symlink, not your
clone.

### Option C: Claude.ai or Claude Desktop (conversation only)

You can upload the skill for general architecture discussions outside a
terminal. Zip the folder so that `jh-repo-mcp-onboarding/` is at the top level
of the archive:

```bash
cd .claude/skills && zip -r ~/jh-repo-mcp-onboarding.zip jh-repo-mcp-onboarding
```

Then upload the zip from the Skills section of Claude's settings (currently
**Customize → Skills**). Custom skills need a paid plan, and your organization's
admins may control whether they're allowed. The menu location changes over time,
so check
[Using Skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
for the current steps.

This option has limits. The skill expects to read source files and verify its
claims against them. It can't do that without the repository, so treat its
answers as intent, not ground truth. For real work, use Option A or B.

---

## 3. Discuss the codebase

Open Claude Code in the repo (Option A) and start with whatever you actually
need. The skill sends each kind of request to a different reference.

| You want to… | Try asking | What happens |
| --- | --- | --- |
| Get oriented from scratch | "I'm new here, walk me through this codebase." | A staged tour (see below) |
| Read it rather than talk through it | "Give me the onboarding walkthrough as a written doc." | All the stages in one pass, without checkpoints |
| Work on something specific | "How does `search_items` get from a query to merged results?" | An end-to-end trace through `architecture.md`, citing files |
| Understand a decision | "Why doesn't this just trust the Solr index?" | Points you to the relevant ADR or spec section, and the tradeoff |
| Challenge the design | "The canonical gate seems over-engineered. Why not fix Solr?" | Takes the question seriously, including what it costs |
| Plan a change | "I want to add a filter for publication year. What do I touch?" | Traces allowlists, profiles, adapters, tests, and spec |

### How the tour works

The tour is interactive, not a document. After a setup stage, it covers five
stages, **one per message**, and ends each with a question:

| Stage | Topic | File you'll open |
| --- | --- | --- |
| 0 | Get it running, and why `dev` exits right away | Your terminal |
| 1 | The problem and the vocabulary (Candidate vs. SearchResult) | `CONTEXT.md` |
| 2 | **The central move**: Solr finds candidates, the canonical API decides truth | `src/adapters/canonicalize.ts` |
| 3 | What a client sees: the closed MCP surface | `src/mcp/tools/search-items.ts` |
| 4 | Federation, rank fusion, stateless cursors | `src/federation/index.ts` |
| 5 | Your first change | Your choice |

A few things to expect:

- **It won't answer its own questions.** Your answer tells it what didn't land. A
  wrong answer is useful: it catches a misconception before it reaches the code.
- **You can leave the tour at any point.** Say you're debugging something
  specific, or that you'd rather read, and it switches modes.
- **It picks up where you stopped.** Come back days later, tell it where you
  left off, and it continues from there.
- **The exit test:** when you finish, you should be able to state the invariants
  from memory. Solr finds candidates and the canonical API decides. Filters and
  allowlists can't be changed by client input. Not-found looks the same for
  missing and restricted records. Scores are never compared across repositories.
  Everything fails closed.

### Getting good answers

- **The code wins.** The skill, `CLAUDE.md`, and this guide are all agent and
  contributor configuration, and they can go out of date. When a document and the
  source disagree, the skill is told to trust the source and say so. If it
  doesn't mention drift and you're about to rely on a claim, ask it to show you
  the line.
- **Ask about behavior, not files.** "What does `canonicalize.ts` do?" gets you a
  file summary. "Can a withdrawn item ever reach a client?" gets you the four
  places that prevent it. The second question is the one you need answered.
- **Don't paste sensitive material** into any session: credentials, internal
  hostnames, security group IDs, or unsanitized Solr or API payloads. See
  [Using AI tools](CONTRIBUTING.md#using-ai-tools).

---

## 4. Build a new MCP server with it

The skill's [`mcp-patterns.md`](.claude/skills/jh-repo-mcp-onboarding/references/mcp-patterns.md)
extracts the reusable parts of this server as ten patterns. Each one gives the
shape, why it exists, what it costs, when it *doesn't* apply, and the worked
example in this repo. The patterns carry the design. The file layout is the
least useful thing to copy.

### Setup

1. Create the new project and open Claude Code with your clone of this repo
   added ([Option B](#option-b-from-another-project-recommended---add-dir)). This
   loads the skill and makes the worked examples readable:

   ```bash
   mkdir my-new-mcp && cd my-new-mcp && git init
   claude --add-dir ~/code/jh-repositories-mcp
   ```

2. Start the conversation from the new server's purpose, not from this repo's
   file tree:

   > I want to build an MCP server modeled on jh-repositories-mcp that gives
   > assistants read-only search over our ArchivesSpace finding aids. Walk me
   > through which of its patterns apply.

### Expect to be asked about your hard guarantee first

This server's guarantee is non-disclosure. Almost every pattern follows from it.
The skill will ask what *your* server's non-negotiable is: tenant isolation,
freshness, cost, auditability, or also non-disclosure. Answer that before you
scaffold anything. Copying the patterns without that reason produces overhead
that protects nothing.

### The ten patterns

| # | Pattern | Worked example here |
| --- | --- | --- |
| 1 | Fast index for candidates, authoritative source for truth | `src/adapters/canonicalize.ts` |
| 2 | Per-backend adapters behind a thin interface, without a forced shared `isPublic()` | `src/adapters/index.ts`, ADR-004 |
| 3 | Allowlist configuration, checked against the real schema at startup | `config/repositories/`, `src/adapters/solr-schema-validator.ts` |
| 4 | Stateless transport, with continuation state in an opaque cursor | `src/federation/index.ts`, ADR-006, ADR-012 |
| 5 | Rank fusion, never score comparison | `mergePages` in `src/federation/index.ts`, ADR-007 |
| 6 | A closed capability registry | `src/mcp/registry.ts`, `test/integration/excluded-capabilities.test.ts` |
| 7 | The host model does the synthesis | ADR-009 |
| 8 | All backend content is untrusted data | `src/observability/index.ts`, `src/mcp/prompts.ts` |
| 9 | Fail closed everywhere, including at the edges | `src/config/env.ts`, `src/security/index.ts` |
| 10 | Invariants encoded as property tests | `test/property/`, `test/contract/` |

The skill also suggests a build order, the same order this repo was built in:
spike the real backends first, then scaffold, models, profiles, and the safe
query layer (with property tests). After that, build one backend end to end
before adding a second, then federation, then tools one at a time. Write ADRs as
you go.

### Examples already in this repo

Two specs here were written with this approach. They're useful to read before
you start:

- **A sibling server:** [`.kiro/specs/agent-knowledge-base/`](.kiro/specs/agent-knowledge-base/)
  describes a small read-only MCP server for a curated markdown corpus. It
  deliberately uses the same stack and conventions (pinned Bun, strict
  TypeScript, Hono, stateless transport, strict schemas, property tests at 100 or
  more runs) and drops what doesn't apply, such as rank fusion and the canonical
  gate. It's a good model of adapting the patterns rather than copying them.
- **Extending this server:** [`.kiro/specs/n-repository-federation/`](.kiro/specs/n-repository-federation/)
  generalizes the two-repository federation (cursor, tie-break, merge) to N
  adapters. Read it before you plan a third backend here. The current cursor is
  hard-coded for exactly two sources.

### Pairing with a general MCP skill

This skill explains *why* the server is built the way it is. It doesn't teach MCP
SDK basics from scratch. If you're new to MCP itself, the general-purpose
`mcp-builder` skill (from Anthropic's skills collection) covers SDK mechanics and
tool design. Use it with this one: `mcp-builder` for the protocol, this skill for
the architecture.

---

## 5. Your first change

Adding a capability to *this* server (a tool, resource, prompt, or anything
outside Requirement 17) starts with **a spec change, not a PR**. See
[Scope](CONTRIBUTING.md#scope). Within that scope, three good first changes:

1. **Add a property test** for an invariant that lacks one (`test/property/`,
   at least 100 `fast-check` cases). This is the lowest-risk option, and it makes
   you state an invariant precisely.
2. **Fix a known rough edge** from the list in
   [`CLAUDE.md`](CLAUDE.md#known-rough-edges). Each one is small, actually
   broken, and takes you through one module. Confirm it's still broken first.
3. **Pick up open spec work** from
   [`tasks.md`](.kiro/specs/jscholarship-jhrdr-mcp/tasks.md). Tasks 20, 21, 25,
   and 26 are open.

Go through the full loop once:

```bash
bun test && bun run typecheck && bun run lint
bun run changelog:new          # add a changelog.d/ fragment; never hand-edit CHANGELOG.md
```

Then open a PR that summarizes the scope, cites the requirement and task numbers,
lists the checks you ran, and calls out any schema, security, config, or infra
impact. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the details.

---

## Keeping the skill accurate

The skill is agent configuration. It rots quietly, because nothing fails when it's
wrong. A stale reference leads to confidently wrong changes at scale.

- **When you change behavior, check the skill.** `references/architecture.md`
  names real functions and paths. If you rename or move something it cites,
  update it in the same PR.
- **When you fix drift, update the drift lists.** Known drift is tracked in
  `references/doc-map.md` and in the rough-edges section of `CLAUDE.md`. Remove
  entries you've fixed so the skill stops warning about problems that no longer
  exist.
- **Test skill edits by using them.** After editing, start a new session and ask
  the questions the skill is meant to answer: a tour opener, a narrow "how does X
  work", and a "build another one like this". Check that it routes correctly and
  cites the right files. For larger rewrites, the `skill-creator` skill can run
  structured evals.

### Reporting drift

When a document and the code disagree, the code wins. Fix the document in the
same PR if it's small. Otherwise, add it to the rough-edges list in `CLAUDE.md`
and to the drift list in `references/doc-map.md`, so the skill warns the next
person instead of misleading them.

---

## Where to go next

| Question | Read |
| --- | --- |
| What's the current state, and what are the invariants and commands? | [`CLAUDE.md`](CLAUDE.md) |
| What does this term mean exactly? | [`CONTEXT.md`](CONTEXT.md) |
| Why was it built this way? | [`docs/adr/`](docs/adr/README.md), starting with ADR-005 |
| Is this behavior required or incidental? | [`requirements.md`](.kiro/specs/jscholarship-jhrdr-mcp/requirements.md) |
| What do the deployed Solr schemas actually contain? | [`docs/spike/`](docs/spike/) |
| How do I make and submit a change? | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| What are the team's coding standards? | [`.kiro/steering/`](.kiro/steering/) |
| Can I add this fixture? | `test/fixtures/*/README.md` |
