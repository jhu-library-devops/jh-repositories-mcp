---
title: Maintaining these docs
sources:
  - scripts/docs/
  - docs/.vitepress/
  - .github/workflows/ci.yml
  - .github/workflows/docs.yml
  - .github/workflows/docs-impact.yml
  - .github/workflows/docs-freshness.yml
  - package.json
verified: 2026-10-21
---

# Maintaining these docs

This site is a technical reference for the current system. It describes interfaces, behavior, and procedures. It does not track plans, progress, or history: release notes go in `changelog.d/` fragments, and design intent stays in the project specifications. A page should never need to say what is "coming" or what was "recently" done.

## Where things go

| Content | Location | Published |
| --- | --- | --- |
| Tools, schemas, configuration, repository capabilities, errors, infrastructure | `docs/reference/` (generated) | Yes |
| How the system works | `docs/architecture/` | Yes |
| How to extend or operate it | `docs/guides/` | Yes |
| Why a structural choice was made | `docs/adr/` (append-only; supersede, don't edit) | Yes |
| Schema and endpoint investigations | `docs/spike/` | No: working records |
| Requirements, design, task plans | `.kiro/specs/` | No: working records |
| Release notes | `changelog.d/` → `CHANGELOG.md` | No |

The root files (`README.md`, `CONTRIBUTING.md`, `ONBOARDING.md`, `CLAUDE.md`, `AGENTS.md`) stay short and link here instead of repeating reference content.

## How freshness is enforced

| Mechanism | What it catches | Blocking |
| --- | --- | --- |
| Generated reference (`bun run docs:generate --check`) | Any difference between the code and `docs/reference/` or an injected region | Yes, in CI |
| Lint and links (`bun run docs:lint`, `bun run docs:links`) | Markdown style, broken local links and anchors | Yes, in CI |
| Cited paths (`bun run docs:paths`) | An inline-code path such as `src/adapters/index.ts`, or a `sources:` entry, that no longer exists | Yes, in CI |
| Public-content guard (`bun run docs:public`) | AWS account or resource IDs, private IPs, internal hostnames in published pages | Yes, in CI and before deploy |
| Site build (`bun run docs:build`) | Dead links between pages, invalid front matter | Yes, in the docs workflow |
| Doc-impact comment (`bun run docs:impact`) | A pull request changes code that a page's `sources:` names, without touching the page | No: advisory comment |
| Weekly sweep (`bun run docs:stale`) | A page whose sources changed after its `verified:` date, or that hasn't been verified in 90 days | No: one tracking issue |

`bun run docs:check` runs everything that blocks CI except the site build.

## Page front matter

Every hand-written page outside `docs/adr/` declares what it describes:

```yaml
---
title: Canonical gate
sources:
  - src/adapters/canonicalize.ts   # a file
  - src/adapters/jhrdr/            # a directory
  - config/repositories/*.ts       # a glob
verified: 2026-10-21
---
```

- `sources` drives both the doc-impact comment and the weekly sweep. List the code a reader would need to check to know the page is still right, and nothing broader.
- `verified` is the date someone last read the page against those sources. Update it whenever you check the page, even if nothing needed to change. It is maintenance metadata and isn't shown on the page.

## Generated pages and injected regions

Generators live in `scripts/docs/generators/`. Each reads the code directly (the live MCP server's `tools/list`, the zod configuration schema, the repository profiles run through the real query builder, the error unions, and terraform-docs) and owns its page completely. Never edit a file under `docs/reference/` by hand.

Short generated snippets can also appear inside hand-written files between markers:

```md
<!-- docs:inject mcp-surface-summary -->
…generated content…
<!-- /docs:inject -->
```

Available regions: `mcp-surface-summary` and `configuration-summary`. Use an injected region instead of restating a fact that will change, such as a tool list or a set of variables.

Where a generator needs words the code doesn't contain (variable descriptions, error meanings), it keeps them in a `Record` keyed by the code's own type, so adding a variable or error code without describing it fails `bun run typecheck`.

## When a spec lands

Specs record intent; this site records the result. Finish every spec's task plan with a documentation task:

```md
- [ ] N. Update the developer reference
  - Run `bun run docs:generate` and commit the regenerated reference.
  - Update the architecture and guide pages whose `sources:` cover the changed code; set `verified:` to today.
  - Describe the system as built. Leave out task numbers, phases, and "new" or "now" language.
  - Record any structural decision as an ADR in `docs/adr/`.
  - Run `bun run docs:check` and `bun run docs:build`.
```

## Release drift audit

Before a release, read the open freshness issue and the pages it lists, and compare each with its sources. With Kiro, `#docs-drift-audit` in chat loads a steering file that walks an agent through the same comparison and has it fix the pages in a pull request.

## The site

The site is built with [VitePress](https://vitepress.dev) from `docs/` and published to GitHub Pages from `main` by `.github/workflows/docs.yml`. Its look follows the Johns Hopkins visual identity: Heritage Blue and Spirit Blue, Source Serif 4 for headings, Work Sans for text (self-hosted). The theme layer is `docs/.vitepress/theme/`.

| Command | Purpose |
| --- | --- |
| `bun run docs:dev` | Local preview with hot reload |
| `bun run docs:build` | Production build into `dist/` under `docs/.vitepress/` |
| `bun run docs:preview` | Serve the production build |

Links between pages are relative Markdown links (`./federation.md`) so they work on GitHub and on the site. Links to files outside the site, such as source files, are rewritten to GitHub URLs at build time.
