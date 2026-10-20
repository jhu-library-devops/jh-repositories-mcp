# Repository Guidelines

## Project Structure & Module Organization

The service is implemented; `CLAUDE.md` has the current state, invariants, and known rough edges, and code is ground truth where a document disagrees. The design authority is `.kiro/specs/jscholarship-jhrdr-mcp/`: `requirements.md` defines acceptance criteria, `design.md` defines architecture and data models, and `tasks.md` gives the dependency-ordered implementation sequence with completion state. Keep these files consistent by preserving their requirement-number cross-references.

Layout: `src/adapters/{jscholarship,jhrdr}/` for platform-specific behavior behind the `RepositoryAdapter` seam in `src/adapters/index.ts`, `src/federation/` for merging and cursors, `src/mcp/` for the protocol surface, `config/repositories/` for profiles, `infra/` for OpenTofu, and `test/{unit,property,contract,integration,fixtures}/` for verification. Do not leak Solr field names outside adapter boundaries.

## Build, Test, and Development Commands

- `bun install --frozen-lockfile` — install the committed lockfile with the pinned Bun version (`.bun-version`). `bun ci` is an equivalent alias in the pinned 1.3.11; CI and the Dockerfile use the long form.
- `bun run typecheck` — strict TypeScript checks (`tsc --noEmit`; Bun's bundler does not type-check).
- `bun test` — run unit, property, contract, and integration tests.
- `bun run lint` / `bun run format` — Biome check and format.
- `bun run build` — create the Bun-targeted bundle.
- `bun run changelog:new` — add a `changelog.d/` fragment; never hand-edit `CHANGELOG.md`.

For documentation-only changes, also run `git diff --check`, and when touching the spec, review all three spec files for consistency.

## Coding Style & Naming Conventions

Use strict TypeScript and two-space indentation. Biome (`biome.json`) governs the details: double quotes, trailing commas, 100-column lines. Use `camelCase` for functions and variables, `PascalCase` for types and classes, and lowercase repository IDs (`jscholarship`, `jhrdr`). Preserve the fixed snake-case MCP names, such as `search_items`. Prefer small modules and keep repository-specific mapping, URLs, filters, and allowlists inside the corresponding adapter.

## Testing Guidelines

Add tests with each behavior change. Name TypeScript tests `*.test.ts` and place suites in the matching `test/` subdirectory. Property tests must run at least 100 generated cases per property. Prioritize public-record filtering, Solr escaping, canonical API validation, indistinguishable not-found responses, cursor determinism, log redaction, and fail-closed behavior.

## Commit & Pull Request Guidelines

History uses short, imperative, sentence-case subjects, for example `Add Kiro spec for JScholarship/JHRDR MCP server`. Keep commits focused. Pull requests should summarize scope, cite affected requirement and task numbers, list verification performed, and call out schema, security, configuration, or infrastructure impacts. Link the relevant issue when available. Never commit credentials, private endpoints, or unreviewed repository payloads; sanitize fixtures before adding them.
