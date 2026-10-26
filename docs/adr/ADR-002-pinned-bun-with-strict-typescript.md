# ADR-002: Pinned Bun Release with Strict TypeScript

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

The server needs a JavaScript runtime, a package manager, a bundler, and a test runner, and its behavior has to be reproducible across local development, CI, and the production container. We had to choose a runtime and a toolchain strategy.

## Decision Drivers

- Reproducibility across local, CI, and container environments
- Web Standard transport compatibility, with no dependence on Node.js-specific APIs
- As few separately versioned tools as possible

## Considered Options

1. **A pinned Bun release with strict TypeScript.** Chosen.
2. **Node.js with npm or pnpm, esbuild or rollup, and vitest or jest.** Rejected: four tools with four version streams to keep aligned, and the MCP SDK's Web Standard transport would need a compatibility layer over Node's HTTP APIs.
3. **Deno.** Rejected: its npm compatibility was less complete at the time, and the team had no Deno experience to draw on.

## Decision Outcome

A pinned Bun release, recorded in `.bun-version`, serves as runtime, package manager, bundler, and test runner, with strict TypeScript checked separately by `tsc --noEmit`.

### Positive Consequences

- One version file governs every environment.
- Installs, builds, and tests are faster than the equivalent Node.js toolchain.
- Bun's native Web Standard `Request` and `Response` match the MCP SDK's transport directly.
- `bun install --frozen-lockfile` keeps installs reproducible, and one multi-stage image uses the same Bun for every phase.

### Negative Consequences

- Bun is younger than Node.js, so runtime edge cases are possible.
- Contributors must install Bun locally.
- Packages with Node.js-specific native addons may not work. None are needed here.
- Bun's bundler does not type-check, so `tsc --noEmit` remains a separate gate.

## Links

- [Run the server locally](../guides/local-development.md)
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
