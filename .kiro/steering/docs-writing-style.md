---
inclusion: fileMatch
fileMatchPattern: "docs/**/*.md"
---

# Developer docs writing style

Apply this whenever you write or revise a page under `docs/`, a root document
(`README.md`, `ONBOARDING.md`, `CONTRIBUTING.md`), or the onboarding skill's
references. `docs/guides/maintaining-docs.md` is the published summary; this
file is the working rule set.

## Audience

Write for someone competent but new to one half of the stack: a repository
engineer who has not used MCP, or an MCP developer who has not used DSpace or
Dataverse. Assume neither. When a term from one world is load-bearing, link
`docs/architecture/concepts.md` or the glossary rather than explaining inline.

## Register

- Second person ("you"), present tense, active voice.
- Guides get imperative titles: "Add a repository", "Deploy and roll back".
  Architecture pages get noun titles: "Canonical gate", "Federation and
  pagination". Section headings inside a guide are imperative too.
- State the rule, then the failure it prevents. "Errors never explain" is a
  slogan; "an error that said *withdrawn* would confirm the record exists" is
  a reason. Every invariant on a page should carry at least one such sentence.
- Tables carry facts. Causality goes in prose next to the table, not in a
  fourth column of fragments.
- No team asides, no opinions about the design's reputation ("looks
  over-engineered", "always the wrong call"), no reassurance. If a sentence
  would read oddly on another organisation's public site, cut it.
- No hedging adverbs in front of a fact the code settles. Check the code and
  write the fact.

## Content rules

- Describe the system as built. No task numbers, requirement numbers, phases,
  "planned", "coming soon", "new", "now", or "recently". Specification
  identifiers stay in source comments and `.kiro/`.
- Behavior that differs from the design's intent goes on
  `docs/architecture/known-limitations.md`, phrased as what the code does,
  with the setting or module that bounds it. Delete the entry when the gap
  closes.
- One home per fact. Setup commands live in `docs/guides/local-development.md`,
  the disclosure guarantee and its four layers on
  `docs/architecture/canonical-gate.md`, the source layout and topology on
  `docs/architecture/overview.md`, vocabulary in `docs/glossary.md`. Elsewhere,
  link. Root files stay short.
- Use the glossary's terms exactly and never the alternatives it lists.
- ADRs follow MADR. Each rejected option gets one sentence on why it lost.
  Links point to architecture pages, plus at most one "Specification (working
  record)" link to the `.kiro` design document. No task or branch references.
- Governance (owners, assignees, open questions) belongs in an issue or
  `CODEOWNERS`, never in page prose.
- The repository is public. Never write hostnames, account IDs, resource IDs,
  security group IDs, availability zones, or IP addresses into `docs/`.
- Relative Markdown links between pages (`./federation.md`) so they work on
  GitHub and on the site. Anchors must exist; `bun run docs:links` checks them.

## Mechanics

- Every hand-written page outside `docs/adr/` declares `sources:` and
  `verified:`. Set `verified:` to today whenever you read the page against its
  sources, even if nothing changed.
- When a page's `sources:` include code changed by an open pull request, say
  so in the pull request rather than describing the pre-merge state as
  current.
- Finish with `bun run docs:check` and `bun run docs:build`.
