# Onboarding

The path for a new contributor to `jh-repositories-mcp`: get the service
running, learn how it works, and make a first change. If you only read one
other document, make it
[ADR-005](docs/adr/ADR-005-solr-candidates-canonical-api-gate.md). The rest of
the design follows from it.

## What you're joining

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server
that gives AI research assistants one search interface over two separately
operated Johns Hopkins repositories:

| Repository | Platform | Candidate index | Source of truth |
| --- | --- | --- | --- |
| **JScholarship** (theses, articles, reports) | DSpace | SolrCloud `search` | DSpace REST |
| **JHRDR** (research datasets) | Dataverse | Solr `collection1` | Dataverse Native API |

One rule shapes the whole design: the server never discloses a record that
isn't public, and never lets a client infer that such a record exists. Solr
finds candidates; the platform's public API decides what is real and public.
[Canonical gate](docs/architecture/canonical-gate.md) explains the mechanism,
and if either MCP or the repository platforms are new to you,
[Concepts](docs/architecture/concepts.md) covers each for people who know the
other.

## 1. Get it running

Follow [Run the server locally](docs/guides/local-development.md). It takes a
few minutes: install with the pinned Bun, run the checks, start the server with
the minimum environment, and confirm `/health/live` answers. Come back here once
it does.

Two things on that page surprise people, so you know in advance: `bun run dev`
with no environment exits immediately and lists every missing variable, which
is the intended fail-fast behavior; and `/health/ready` stays 503 without a
reachable Solr, which is also intended.

## 2. Learn the codebase

Read in this order. Each page is short.

1. [Concepts](docs/architecture/concepts.md), if you need it.
2. [Architecture overview](docs/architecture/overview.md): the request path and
   the adapter seam.
3. [Canonical gate](docs/architecture/canonical-gate.md): the four layers that
   enforce the disclosure guarantee.
4. [Federation and pagination](docs/architecture/federation.md) and
   [Security model](docs/architecture/security.md).
5. The [glossary](docs/glossary.md). The code and the specs use these terms
   exactly, and picking them up early makes everything else cheaper to read.

### The guided tour

The repo also ships a Claude Code skill,
[`jh-repo-mcp-onboarding`](.claude/skills/jh-repo-mcp-onboarding/SKILL.md),
that walks you through the code one stage at a time, checks that each idea
landed, and traces behavior end to end when you ask a narrower question. It
loads automatically when you open this repository in Claude Code and accept the
workspace. Ask "walk me through this codebase", or call
`/jh-repo-mcp-onboarding` directly.

How to install the skill from another project or in Claude.ai, how to get good
answers from it, and how to use it to build a new MCP server on the same design
are all in the [skill's README](.claude/skills/jh-repo-mcp-onboarding/README.md).

## 3. Your first change

Adding a capability to this server (a tool, resource, prompt, or anything
outside the fixed v1 scope) starts with a spec change, not a PR; see
[Scope](CONTRIBUTING.md#scope). Within scope, three good first changes:

1. **Add a property test** for an invariant that lacks one (`test/property/`,
   at least 100 `fast-check` cases). Lowest risk, and it makes you state an
   invariant precisely.
2. **Fix a known limitation** from
   [Known limitations](docs/architecture/known-limitations.md). Each is small,
   real, and takes you through one module. Confirm it is still present first.
3. **Pick up open spec work.** The unchecked items in each
   `.kiro/specs/*/tasks.md` are the current plan.

Go through the full loop once:

```bash
bun test && bun run typecheck && bun run lint
bun run changelog:new          # add a changelog.d/ fragment; never hand-edit CHANGELOG.md
```

If you changed the MCP surface, configuration, a repository profile, error
codes, or `infra/`, also run `bun run docs:generate` and commit the result. The
PR gets an advisory comment listing developer-reference pages to recheck.

Then open a PR as [`CONTRIBUTING.md`](CONTRIBUTING.md#commits-and-pull-requests)
describes.

## Keeping the docs and the skill accurate

Documentation and agent configuration rot quietly, because nothing fails when
they are wrong. When a document and the code disagree, the code wins. Fix the
document in the same PR if the fix is small; otherwise open an issue naming the
page and the file. If you rename or move something the skill cites, update
`.claude/skills/jh-repo-mcp-onboarding/references/architecture.md` in the same
PR, then start a new session and ask the questions the skill is meant to
answer.

Don't paste sensitive material into any AI session: credentials, internal
hostnames, security group IDs, or unsanitized Solr or API payloads. See
[Using AI tools](CONTRIBUTING.md#using-ai-tools).

## Where to go next

| Question | Read |
| --- | --- |
| What does a tool, variable, or repository support look like exactly? | The [developer reference](https://jhu-library-devops.github.io/jh-repositories-mcp/) ([`docs/`](docs/index.md)) |
| What are the invariants and commands, in one place? | [`CLAUDE.md`](CLAUDE.md) |
| What does this term mean exactly? | The [glossary](docs/glossary.md) |
| Why was it built this way? | [`docs/adr/`](docs/adr/README.md), starting with ADR-005 |
| Where does the code fall short of the design? | [Known limitations](docs/architecture/known-limitations.md) |
| What's left to build? | The unchecked items in `.kiro/specs/*/tasks.md` |
| Is this behavior required or incidental? | [`requirements.md`](.kiro/specs/jscholarship-jhrdr-mcp/requirements.md) |
| What do the deployed Solr schemas actually contain? | [`docs/spike/`](docs/spike/) |
| How do I make and submit a change? | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| What are the team's coding standards? | [`.kiro/steering/`](.kiro/steering/) |
| Can I add this fixture? | `test/fixtures/*/README.md` |
