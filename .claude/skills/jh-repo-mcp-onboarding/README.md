# The onboarding skill

`jh-repo-mcp-onboarding` is a [Claude Code skill](https://code.claude.com/docs/en/skills):
a folder of instructions that Claude loads when a request matches its
description. It does three jobs for this repository:

- a **guided tour** for new team members, one stage at a time
- an **architecture reference** that traces behavior end to end rather than
  from one file
- a **pattern guide** for building a different MCP server on the same design

```text
jh-repo-mcp-onboarding/
├── SKILL.md                    routing, the invariants, and how to read the repo
└── references/
    ├── walkthrough.md          the staged tour, with checkpoint questions
    ├── architecture.md         module map, request path, where each invariant lives
    ├── doc-map.md              which document answers which question
    └── mcp-patterns.md         ten reusable patterns for building a sibling MCP server
```

This README covers installing and using it. For the contributor path itself,
start at [`ONBOARDING.md`](../../../ONBOARDING.md).

## Install

Pick the setup that matches what you're doing.

### In this repository (nothing to install)

The skill is a project skill, committed under `.claude/skills/`, so Claude Code
finds it when you start a session in this repository:

```bash
git clone https://github.com/jhu-library-devops/jh-repositories-mcp.git
cd jh-repositories-mcp
claude
```

The first time you open the directory, Claude Code asks whether you trust the
workspace. It loads nothing under `.claude/`, this skill included, until you
accept. To check that the skill loaded, type `/jh-repo` and see whether
`/jh-repo-mcp-onboarding` appears in the autocomplete, or ask "which skills do
you have?". Then either just ask ("walk me through this codebase", "how does
pagination work here?") or call `/jh-repo-mcp-onboarding` directly, optionally
followed by your question.

This also works in [Claude Code on the web](https://claude.ai/code): a session
started on this repository has the committed skill available.

### From another project (recommended: `--add-dir`)

To build a new MCP server in a different repository, Claude needs two things
from this one: the skill, and the source files it cites as worked examples,
such as `src/adapters/canonicalize.ts` and `src/federation/index.ts`. Adding
your clone as an extra working directory gives it both:

```bash
cd ~/code/my-new-mcp
claude --add-dir ~/code/jh-repositories-mcp
```

Settings, hooks, and agents from the added directory are not loaded. Only the
skill and the files come across.

To have the skill in every session without `--add-dir`, symlink it into your
personal skills directory from the root of your clone:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/.claude/skills/jh-repo-mcp-onboarding" ~/.claude/skills/jh-repo-mcp-onboarding
```

A symlink stays current when you `git pull`; a copy doesn't. Without
`--add-dir`, the skill can describe the patterns but can't open or cite the
code behind them. To uninstall, remove the symlink:
`rm ~/.claude/skills/jh-repo-mcp-onboarding`.

### Claude.ai or Claude Desktop (conversation only)

You can upload the skill for architecture discussions outside a terminal. Zip
the folder so that `jh-repo-mcp-onboarding/` is at the top level of the
archive:

```bash
cd .claude/skills && zip -r ~/jh-repo-mcp-onboarding.zip jh-repo-mcp-onboarding
```

Then upload the zip from the Skills section of Claude's settings. Custom skills
need a paid plan, and your organization's admins may control whether they're
allowed. The menu location changes over time, so check
[Using Skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
for the current steps.

This option has limits. The skill expects to read source files and verify its
claims against them. It can't do that without the repository, so treat its
answers as intent, not ground truth. For real work, use one of the first two
options.

## Discuss the codebase

Open Claude Code in the repo and start with whatever you need. The skill sends
each kind of request to a different reference.

| You want to… | Try asking | What happens |
| --- | --- | --- |
| Get oriented from scratch | "I'm new here, walk me through this codebase." | A staged tour (see below) |
| Read it rather than talk through it | "Give me the onboarding walkthrough as a written doc." | All the stages in one pass, without checkpoints |
| Work on something specific | "How does `search_items` get from a query to merged results?" | An end-to-end trace through `architecture.md`, citing files |
| Understand a decision | "Why doesn't this just trust the Solr index?" | Points you to the relevant ADR and the trade-off |
| Challenge the design | "The canonical gate seems over-engineered. Why not fix Solr?" | Takes the question seriously, including what it costs |
| Plan a change | "I want to add a filter for publication year. What do I touch?" | Traces allowlists, profiles, adapters, tests, and spec |

### How the tour works

The tour is interactive. After a setup stage, it covers five stages, one per
message, and ends each with a question:

| Stage | Topic | File you'll open |
| --- | --- | --- |
| 0 | Get it running, and why `dev` exits right away | Your terminal |
| 1 | The problem and the vocabulary (Candidate vs. SearchResult) | `docs/glossary.md` |
| 2 | The central move: Solr finds candidates, the canonical API decides truth | `src/adapters/canonicalize.ts` |
| 3 | What a client sees: the closed MCP surface | `src/mcp/tools/search-items.ts` |
| 4 | Federation, rank fusion, stateless cursors | `src/federation/index.ts` |
| 5 | Your first change | Your choice |

- It won't answer its own questions. Your answer tells it what didn't land, and
  a wrong answer catches a misconception before it reaches the code.
- You can leave the tour at any point. Say you're debugging something specific,
  or that you'd rather read, and it switches modes.
- It picks up where you stopped. Come back days later, say where you left off,
  and it continues.
- The exit test: when you finish, you should be able to state the invariants
  from memory. Solr finds candidates and the canonical API decides. Filters and
  allowlists can't be changed by client input. Not-found looks the same for
  missing and restricted records. Scores are never compared across
  repositories. Everything fails closed.

### Getting good answers

- **The code wins.** The skill, `CLAUDE.md`, and the onboarding guide are agent
  and contributor configuration, and they can go out of date. When a document
  and the source disagree, the skill is told to trust the source and say so. If
  it doesn't mention drift and you're about to rely on a claim, ask it to show
  you the line.
- **Ask about behavior, not files.** "What does `canonicalize.ts` do?" gets you
  a file summary. "Can a withdrawn item ever reach a client?" gets you the four
  places that prevent it.
- **Don't paste sensitive material** into any session: credentials, internal
  hostnames, security group IDs, or unsanitized Solr or API payloads. See
  [Using AI tools](../../../CONTRIBUTING.md#using-ai-tools).

## Build a new MCP server with it

[`references/mcp-patterns.md`](references/mcp-patterns.md) extracts the
reusable parts of this server as ten patterns. Each gives the shape, why it
exists, what it costs, when it doesn't apply, and the worked example in this
repo. The patterns carry the design; the file layout is the least useful thing
to copy.

### Setup

1. Create the new project and open Claude Code with your clone of this repo
   added (the `--add-dir` option above):

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

This server's guarantee is non-disclosure, and almost every pattern follows
from it. The skill will ask what *your* server's non-negotiable is: tenant
isolation, freshness, cost, auditability, or also non-disclosure. Answer that
before you scaffold anything. Copying the patterns without that reason produces
overhead that protects nothing.

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

The skill also suggests a build order, the one this repo followed: spike the
real backends first, then scaffold, models, profiles, and the safe query layer
(with property tests). Build one backend end to end before adding a second,
then federation, then tools one at a time. Write ADRs as you go.

### Examples already in this repo

- **A sibling server:** [`.kiro/specs/agent-knowledge-base/`](../../../.kiro/specs/agent-knowledge-base/)
  describes a small read-only MCP server for a curated Markdown corpus. It uses
  the same stack and conventions and drops what doesn't apply, such as rank
  fusion and the canonical gate. A good model of adapting the patterns rather
  than copying them.
- **Extending this server:** [`.kiro/specs/n-repository-federation/`](../../../.kiro/specs/n-repository-federation/)
  generalizes the two-repository federation (cursor, tie-break, merge) to N
  adapters. Read it before you plan a third backend here.

### Pairing with a general MCP skill

This skill explains why the server is built the way it is. It doesn't teach MCP
SDK basics. If you're new to MCP itself, the general-purpose `mcp-builder`
skill from Anthropic's skills collection covers SDK mechanics and tool design.
Use `mcp-builder` for the protocol and this skill for the architecture.

## Keeping the skill accurate

The skill is agent configuration. It rots quietly, because nothing fails when
it's wrong, and a stale reference leads to confidently wrong changes at scale.

- When you change behavior, check `references/architecture.md`. It names real
  functions and paths. If you rename or move something it cites, update it in
  the same PR.
- Test skill edits by using them. After editing, start a new session and ask a
  tour opener, a narrow "how does X work", and a "build another one like
  this". Check that it routes correctly and cites the right files. For larger
  rewrites, the `skill-creator` skill can run structured evals.
