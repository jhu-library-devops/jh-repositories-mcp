# Repository Guidelines

## Project Structure & Module Organization

This repository is specification-first; it does not yet contain application code or a package manifest. The authoritative plan is under `.kiro/specs/jscholarship-jhrdr-mcp/`: `requirements.md` defines acceptance criteria, `design.md` defines architecture and data models, and `tasks.md` gives the dependency-ordered implementation sequence. Keep these files consistent by preserving their requirement-number cross-references.

When scaffolding begins, follow the planned layout: `src/adapters/{jscholarship,jhrdr}/` for platform-specific behavior, `src/federation/` for merging and cursors, `src/mcp/` for the protocol surface, `config/repositories/` for profiles, `infra/` for OpenTofu, and `test/{fixtures,integration,property}/` for verification. Do not leak Solr field names outside adapter boundaries.

## Build, Test, and Development Commands

No build or test command is runnable yet. For documentation-only changes, use `git diff --check` to catch whitespace errors and review all three spec files for consistency. After task 2 scaffolds the service, the specified commands are:

- `bun ci` — install the committed lockfile with the pinned Bun version.
- `tsc --noEmit` — run strict TypeScript checks.
- `bun test` — run unit, property, contract, and integration tests.
- `bun build --target=bun --production` — create the production bundle.

## Coding Style & Naming Conventions

Use strict TypeScript and two-space indentation. Let the repository's future lint and formatting configuration govern details. Use `camelCase` for functions and variables, `PascalCase` for types and classes, and lowercase repository IDs (`jscholarship`, `jhrdr`). Preserve the fixed snake-case MCP names, such as `search_items`. Prefer small modules and keep repository-specific mapping, URLs, filters, and allowlists inside the corresponding adapter.

## Testing Guidelines

Add tests with each behavior change. Name TypeScript tests `*.test.ts` and place cross-cutting suites in the planned `test/` subdirectories. Property tests must run at least 100 generated cases per property. Prioritize public-record filtering, Solr escaping, canonical API validation, indistinguishable not-found responses, cursor determinism, log redaction, and fail-closed behavior.

## Commit & Pull Request Guidelines

History uses short, imperative, sentence-case subjects, for example `Add Kiro spec for JScholarship/JHRDR MCP server`. Keep commits focused. Pull requests should summarize scope, cite affected requirement and task numbers, list verification performed, and call out schema, security, configuration, or infrastructure impacts. Link the relevant issue when available. Never commit credentials, private endpoints, or unreviewed repository payloads; sanitize fixtures before adding them.
