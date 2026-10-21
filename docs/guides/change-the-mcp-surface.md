---
title: Changing the MCP surface
sources:
  - src/mcp/registry.ts
  - src/mcp/tools/
  - src/models/schemas.ts
  - src/adapters/solr-query.ts
  - config/repositories/
  - test/integration/excluded-capabilities.test.ts
verified: 2026-10-21
---

# Changing the MCP surface

The surface is closed on purpose: each new tool, parameter, or field is new ground for the [disclosure guarantee](../architecture/canonical-gate.md) to cover. Changes here are scope changes. Agree on them, and record any structural decision as an ADR, before writing code.

After any change on this page, run `bun run docs:generate`. The [MCP surface](../reference/mcp-surface.md) and [Repositories](../reference/repositories.md) pages update from the code, and CI fails if you forget.

## Add a search field, filter, sort, or facet

The concept has to exist in three places: the public input schema, the shared query builder, and each repository profile that supports it.

1. **Input schema.** Add the value or property to the strict zod schema in `src/models/schemas.ts`. Keep every bound explicit (`max` lengths and item counts).
2. **Query builder.** Translate it in `src/adapters/solr-query.ts`. List filters map through `LIST_FILTER_CONCEPTS`; anything a profile cannot express must be reported in `unsupportedFilters`, never passed through.
3. **Profiles.** Map the concept to a Solr field in each `config/repositories/*-profile.ts` that supports it, and add that field to `requiredSchemaFields` or `optionalSchemaFields` so startup validation checks it exists.
4. **Tests.** Add a property test in `test/property/` (at least 100 cases) showing every emitted field is still allowlisted, and a unit test for the translation.
5. **Verify against a real index.** The schema validator only proves a field exists at startup. Check the field's analysis and values with the deployed schema before relying on it.

Repositories that don't map the concept keep working: filters produce `unsupported_filter` warnings, unmapped facets are skipped with a warning.

## Add or change a tool

1. Write the handler in `src/mcp/tools/<name>.ts`. Go through adapters only; a tool must never see Solr fields or platform URLs.
2. Add strict input and output schemas in `src/models/schemas.ts`.
3. Add the tool to the `TOOLS` table in `src/mcp/registry.ts` with a description and a compact text renderer.
4. Update `test/integration/excluded-capabilities.test.ts`. It fails when the surface grows, so the update is the explicit acknowledgment.
5. Add integration tests in `test/integration/`, including the not-found and partial-result paths.
6. Update `scripts/smoke-test.sh` if the tool list it expects changes.

Resources and prompts follow the same pattern in `src/mcp/resources.ts` and `src/mcp/prompts.ts`. A prompt must keep user arguments inside the fenced user-role data block; see [Security model](../architecture/security.md#repository-content-is-untrusted).

## Change client-visible errors

Error messages are fixed, client-safe strings in `src/mcp/errors.ts`. A new error code goes into the `ToolErrorCode` union in `src/models/index.ts`; the [Errors and warnings](../reference/errors.md) generator then fails type-checking until the code is described. Never let a message distinguish a missing record from a restricted one.
