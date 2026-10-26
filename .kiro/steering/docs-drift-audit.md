---
inclusion: manual
---

# Developer docs drift audit

Use this when asked to audit or refresh the developer reference in `docs/`, typically before a release or when the "Developer docs need review" issue is open.

## Scope

- Audit the hand-written pages: `docs/index.md`, `docs/architecture/`, `docs/guides/`, `docs/glossary.md`, and `docs/related-resources.md`.
- Do not hand-edit `docs/reference/`. Regenerate it with `bun run docs:generate`.
- Do not edit ADRs in `docs/adr/` except to fix broken links. A changed decision gets a new ADR.
- `docs/spike/` and `.kiro/specs/` are working records, not published docs. Read them as background; don't treat them as the description of current behavior.

## Procedure

1. Run `bun run docs:stale` and start with the pages it lists. If asked for a full audit, cover every hand-written page.
2. For each page, read its `sources:` front matter, then read those source files. Code is the ground truth.
3. Check every factual claim on the page against the code: names, defaults, status codes, limits, ordering, and which component does what. Where the code differs, rewrite the page to match the code. Don't change code to match the docs.
4. If a fact is already on a generated page, link to that page instead of restating it.
5. Update `sources:` if the page now depends on different files, and set `verified:` to today's date.
6. Run `bun run docs:generate`, `bun run docs:check`, and `bun run docs:build`. All three must pass.
7. Check the onboarding skill in `.claude/skills/jh-repo-mcp-onboarding/` the same way: it names functions, types, paths, and request-path steps, and nothing fails when those go stale. Fix claims that no longer match the code.
8. Open a pull request listing each page changed and, for each, the code fact that prompted the change.

## Writing rules

Follow `docs-writing-style.md` in this directory: audience, register, one home per fact, no specification identifiers, nothing private, the glossary's terms exactly. When an audit finds behavior that differs from the design's intent, record it on `docs/architecture/known-limitations.md` rather than softening the page that describes the intent.
