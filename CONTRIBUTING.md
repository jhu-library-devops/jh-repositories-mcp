# Contributing

Thanks for working on this. Before your first change, get the toolchain running
with [Run the server locally](docs/guides/local-development.md), and read the
[glossary](docs/glossary.md): the terms are used precisely throughout the code
and specs, and picking them up early makes everything cheaper to read.

If you're new to the codebase, [`ONBOARDING.md`](ONBOARDING.md) is the path:
a reading order, a guided tour through a Claude Code skill, and three good
first changes.

## Before you change behavior

The service exists to guarantee one thing: it never discloses a record that
isn't public, and never lets a client infer that one exists. That guarantee is
enforced in four layers, and a change that looks safe in one can defeat
another, so trace the path end to end before you touch it. The layers, and
what each covers for, are on [Canonical gate](docs/architecture/canonical-gate.md).
[ADR-005](docs/adr/ADR-005-solr-candidates-canonical-api-gate.md) is the
decision the rest follows from.

The other structural rule is the adapter seam.
[`src/adapters/index.ts`](src/adapters/index.ts) is the boundary: Solr field
names, platform URLs, and platform access rules live below it, and nothing above
it may know that Solr, DSpace, or Dataverse exist. See
[the adapter seam](docs/architecture/overview.md#the-adapter-seam).

## Scope

The MCP surface is closed: five tools, two resource templates, two prompts,
strict schemas, no dynamic registration.
`test/integration/excluded-capabilities.test.ts` exists to fail when it grows.

Adding a capability is a **spec change first**: update
[`.kiro/specs/jscholarship-jhrdr-mcp/`](.kiro/specs/jscholarship-jhrdr-mcp/) and
get it reviewed, then implement. Every new tool is new attack surface against
the disclosure guarantee. The same applies to anything outside the v1
boundaries the spec sets: auth, writes, file-content proxying, vector search,
embedded models.

When you change the spec, keep `requirements.md`, `design.md`, and `tasks.md`
mutually consistent. They cross-reference each other by requirement number, and
so do source comments (`_Requirements: 2.4-2.6_`).

## Tests

Add tests with each behavior change. [Write tests and fixtures](docs/guides/testing-and-fixtures.md)
explains what each directory under `test/` is for and what to cover first. The
rules that matter most:

- Invariants go in `test/property/` as `fast-check` generated cases, **at least
  100 per property**. One property beats three examples.
- `test/integration/non-public-disclosure.test.ts` and
  `test/integration/excluded-capabilities.test.ts` are guardrails. If a change
  makes one fail, the change is the suspect.
- Changing an immutable filter or a public check means adding a fixture for the
  newly excluded case and extending `non-public-disclosure.test.ts`. Never
  change one enforcement layer without a test showing the others still hold.

## Fixtures

`test/fixtures/` holds sanitized payloads, including deliberately withdrawn and
restricted records. Read the `README.md` in the relevant fixture directory
before adding one, and sanitize before committing: remove credentials, private
endpoints, and any content that isn't already public.

## Style

Biome owns formatting (`bun run lint`, `bun run format`). Strict TypeScript with
`bun run typecheck` as a separate gate from the build. Team standards live in
[`.kiro/steering/`](.kiro/steering/): TypeScript, error handling, logging,
security, and testing. They're short; read them once.

Naming: `camelCase` functions and variables, `PascalCase` types and classes,
lowercase repository ids (`jscholarship`, `jhrdr`), and the fixed snake_case MCP
tool names (`search_items`) exactly as the registry declares them.

### Documentation checks

`bun run docs:check` runs everything CI enforces on documentation: Markdown
style, local links and anchors, cited repository paths, the public-content
guard, and whether the generated reference is current. Link validation is
repository-local and does not probe external URLs, so the gate is deterministic.

## Changelog

Describe changes with a fragment rather than editing [`CHANGELOG.md`](CHANGELOG.md)
directly:

```bash
bun run changelog:new       # create a fragment in changelog.d/
bun run changelog:preview   # dry-run the assembled changelog
```

## Commits and pull requests

Commits use short, imperative, sentence-case subjects: `Add cursor reset warning
to search_items`. Keep them focused.

Pull requests should:

- summarize the scope of the change
- cite the requirement and task numbers it advances
- list the verification performed
- call out schema, security, configuration, or infrastructure impacts
- link the relevant issue when there is one

CI runs lint, documentation checks, typecheck, test, build, and a dependency
audit. Get it green before requesting review.

**Never commit credentials, private endpoints, or unreviewed repository
payloads.**

## Attribution

Contributions are licensed inbound under the [Apache License 2.0](LICENSE),
the same license the project ships under. By opening a pull request you're
confirming you have the right to contribute the code — that it's your own work, or
that you're authorized to submit it and its license is compatible with Apache-2.0.
That's the whole affirmation: there's no DCO sign-off and no CLA to sign.

Credit people in the commit, not just the PR thread. If someone pairs with you,
debugs it with you, or hands you the fix, add them:

```
Co-authored-by: Ada Lovelace <ada@jhu.edu>
```

**Third-party code.** Don't paste code from Stack Overflow, blog posts, other
repositories, or model output that reproduces a recognizable existing
implementation without checking its license and recording where it came from. If a
non-trivial block is adapted from somewhere, note the source and its license in a
comment above it. Anything incompatible with Apache-2.0 — GPL, AGPL, CC BY-NC,
license-absent code — doesn't go in, and neither does a vendored copy of something
we should be depending on properly.

**New dependencies** need a reason in the PR description: what it does, why the
standard library or an existing dependency won't, and its license. This service
runs against private infrastructure and returns data with a disclosure guarantee
attached, so the supply chain is part of the threat model.

## Using AI tools

This project is built with AI assistance and expects it — the Kiro spec workflow in
[`.kiro/`](.kiro/) and the onboarding skill in [`.claude/skills/`](.claude/skills/)
are part of the normal toolchain. (Agent definitions under `.claude/agents/` are
per-developer and gitignored, so a fresh clone won't have any.) What follows isn't
discouragement, it's the operating manual.

**You own what you submit.** Authorship of a PR means you understand every line in
it, can explain why it's correct, and take responsibility if it isn't. "The model
wrote it" is not a review response. If you can't explain a hunk, don't ship it.

**Never paste sensitive material into a third-party tool.** Specifically: credentials,
private endpoint names and internal DNS, security group ids, unsanitized Solr or
canonical API payloads, and metadata for any record that isn't confirmed public.
The fixtures in `test/fixtures/` are safe because they were sanitized deliberately;
a payload you just pulled off a private endpoint is not. When in doubt, redact
before you paste.

**Verify agent claims against the source.** Agents are confident about this repo in
ways that aren't always warranted — they'll cite requirement numbers, describe
functions, and summarize docs that have since drifted. Check the file. This is also
why [`CLAUDE.md`](CLAUDE.md), [`.kiro/steering/`](.kiro/steering/), and the
onboarding skill need to stay accurate: they're agent configuration, and stale
guidance produces confidently wrong changes at scale.

**Be skeptical of agent-written tests.** A test written by the same agent that wrote
the implementation tends to encode the same misunderstanding, and it passes. For
anything touching the disclosure guarantee, write the property or the fixture case
yourself, or at minimum verify it fails against the un-fixed code.

**The invariants are not negotiable by an agent.** An agent asked to fix a
pagination bug or a latency problem will sometimes propose relaxing the canonical
gate, weakening an immutable filter, or falling back to Solr metadata — these are
locally reasonable and globally wrong. Anything that weakens the disclosure
guarantee is a spec change with security review, no matter how it was arrived at.

**Noting AI generation is optional.** If a model produced most of a change rather
than assisting with it, you're welcome to say so with a trailer:

```
Assisted-by: <tool>
```

It's not required, and it isn't a scarlet letter — nearly everything here is
written with assistance, so the trailer carries signal only where you think a
reviewer would want it. Authorship is what matters, and that's covered above.

**Choosing tools.** There's no approved-vendor list in this document, deliberately:
such a list dates quickly and reads as endorsement. Use what your unit sanctions,
and let the data-handling rule above decide the hard cases — if a tool would send
credentials, internal endpoint names, or unsanitized repository payloads somewhere
you can't account for, it's the wrong tool for that task regardless of who
approved it. Check with your supervisor when a tool is new to the team.

## Documentation

The developer reference in [`docs/`](docs/index.md) is published to GitHub
Pages. It describes the system as built: no plans, task numbers, or progress
notes. Release notes go in `changelog.d/`, intent stays in the specs.

- **Generated pages.** `docs/reference/` is generated from source. If you change
  the MCP surface, configuration, a repository profile, error codes, or `infra/`,
  run `bun run docs:generate` and commit the result. CI fails otherwise.
- **Hand-written pages.** Each declares the code it describes in `sources:` front
  matter. A PR that changes those files gets an advisory comment listing the pages
  to recheck. When you check a page, update its `verified:` date even if nothing
  changed.
- **Public repository.** The site is public. Never put hostnames, account or
  resource IDs, or IP addresses in `docs/`; the public-content guard fails the
  build if you do.

Where a document and the source disagree, the source wins. If you find drift, say
so in the PR and fix the document. ADRs are append-only: supersede a decision with
a new ADR rather than editing the old one. Details are in
[Maintain these docs](docs/guides/maintaining-docs.md).
