# ADR-003: Hono with MCP SDK Web Standard Streamable HTTP Transport

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

The server needs an HTTP framework to host the MCP Streamable HTTP endpoint, the health routes, and the edge middleware (Host validation, Origin checks, request limits, correlation IDs, deadlines). The official MCP TypeScript SDK offers both a Node.js-specific transport and a Web Standard one. We had to choose a framework that works with Bun and with the SDK's stateless model.

## Decision Drivers

- MCP Streamable HTTP served at `/mcp`
- A Web Standard transport, not a Node.js-specific one
- Bun's native support for Web Standard `Request` and `Response`
- Middleware for Host, Origin, size limits, correlation IDs, and deadlines

## Considered Options

1. **Hono with the SDK's Web Standard Streamable HTTP transport.** Chosen.
2. **Express or Fastify with the SDK's Node.js transport.** Rejected: both frameworks are built on Node's `http` module, which Bun emulates rather than implements natively, and the Node transport would tie the server to that emulation layer.
3. **Raw `Bun.serve` with hand-written routing.** Rejected: workable for one route, but the middleware chain (five edge checks plus health routes) would mean rebuilding what Hono already provides.

## Decision Outcome

Hono hosts the routes and middleware, and hands the standard `Request` from `c.req.raw` to the SDK's Web Standard transport.

### Positive Consequences

- Hono is small, fast, and designed for Web Standard environments.
- A mature middleware ecosystem covers the common HTTP concerns.
- No Node.js compatibility layer sits in the request path.
- If an official Hono adapter for the SDK stabilizes, migration is small.

### Negative Consequences

- A change to the SDK's Web Standard API would require updating the integration.
- Hono is less widely known than Express, though well established in edge and Bun contexts.
- The glue between Hono and the SDK is project code until an official adapter exists.

## Links

- [Architecture overview](../architecture/overview.md), request path
- [Security model](../architecture/security.md), edge controls
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
