# ADR-003: Hono with MCP SDK Web Standard Streamable HTTP Transport

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

The MCP server needs an HTTP framework to host the MCP Streamable HTTP endpoint, health checks, and middleware (Host validation, Origin checks, request limits). The official MCP TypeScript SDK supports both Node.js-specific and Web Standard transports. We must choose a framework that works with Bun and the SDK's stateless model.

## Decision Drivers

- Requirement 12.1: MCP Streamable HTTP at `/mcp`
- Requirement 12.8: Web Standard transport, not Node.js-specific
- Bun's native support for Web Standard Request/Response
- Need for middleware (Host, Origin, size limits, correlation IDs, deadlines)
- Official MCP SDK's `WebStandardStreamableHTTPServerTransport`

## Considered Options

1. Hono with MCP SDK's Web Standard Streamable HTTP transport
2. Express/Fastify with Node.js MCP transport adapter
3. Raw Bun.serve with manual routing and direct SDK integration

## Decision Outcome

**Chosen option:** Option 1 — Hono with the MCP SDK's Web Standard Streamable HTTP transport, because the official MCP SDK supports Bun through Web Standard Request/Response APIs and Hono provides the HTTP framework without coupling to the Node.js HTTP transport.

### Positive Consequences

- Hono is lightweight, fast, and designed for Web Standard environments
- Rich middleware ecosystem for common HTTP concerns
- Direct access to `c.req.raw` (standard Request) for SDK integration
- No Node.js compatibility layer required
- If an official `@modelcontextprotocol/hono` adapter stabilizes, migration is straightforward

### Negative Consequences

- If the MCP SDK changes its Web Standard API, the integration layer needs updating
- Hono is less established than Express in the Node.js ecosystem (though well-established in edge/Bun contexts)
- Custom integration code between Hono and the SDK if no official adapter exists

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table, Component 1
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 12.1, 12.2, 12.8
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 16.1, 16.2
- Branch: tofu-iac-starter
