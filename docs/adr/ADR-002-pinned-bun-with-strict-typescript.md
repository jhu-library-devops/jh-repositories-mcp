# ADR-002: Pinned Bun Release with Strict TypeScript

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

The MCP server needs a JavaScript/TypeScript runtime, package manager, bundler, and test runner. Reproducibility across local development, CI, and production containers is critical. We must choose a runtime and toolchain strategy.

## Decision Drivers

- Requirement 12.7: Strict TypeScript with pinned Bun as runtime, package manager, build tool, and test runner
- Requirement 12.8: Web Standard transport compatibility (no Node.js-specific APIs)
- Reproducibility across local, CI, and container environments
- Minimizing toolchain fragmentation (separate bundler, test runner, package manager)

## Considered Options

1. Pinned Bun release (runtime + package manager + bundler + test runner) with strict TypeScript
2. Node.js + npm/pnpm + esbuild/rollup + vitest/jest
3. Deno with TypeScript

## Decision Outcome

**Chosen option:** Option 1 — Pinned Bun release with strict TypeScript, because Bun provides the runtime, package manager, bundler, and test runner in one tool; a single pinned version keeps local, CI, and container behavior reproducible.

### Positive Consequences

- One version file (`.bun-version`) governs all environments
- Faster installs, builds, and test execution compared to Node.js toolchains
- Native Web Standard Request/Response APIs align with the MCP SDK's transport
- `bun ci` ensures reproducible lockfile installs
- Single multi-stage Docker image uses the same Bun for all phases

### Negative Consequences

- Bun is less mature than Node.js; edge-case runtime bugs are possible
- Team members must install Bun locally
- Some npm packages with Node.js-specific native addons may not work (not expected for this project)
- `tsc --noEmit` is still required separately for type-checking (Bun does not replace the TypeScript compiler)

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 12.7, 12.8
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 2.1, 19.1
- Branch: tofu-iac-starter
