# ADR-006: Stateless MCP Streamable HTTP with JSON Responses

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

The MCP specification supports both session-bound and stateless transports. The service runs as several ECS Fargate tasks behind an application load balancer that does not guarantee request affinity. We had to decide whether to hold server-side session state.

## Decision Drivers

- Several Fargate tasks without sticky sessions
- All pagination state carried in an opaque, client-held cursor
- No shared state infrastructure to operate

## Considered Options

1. **Stateless Streamable HTTP with JSON responses and no session ID.** Chosen.
2. **Stateful sessions backed by Redis or DynamoDB.** Rejected: the only state the service has is a page offset, and standing up a shared store to hold a page offset adds a dependency, a cost, and a failure mode to carry a few bytes the client can hold itself.
3. **Stateful sessions with load-balancer stickiness.** Rejected: stickiness breaks on task replacement and deployment, exactly when a researcher mid-pagination would notice.

## Decision Outcome

Each request creates a fresh MCP server and transport with no session ID and answers with JSON. The cursor carries everything needed to continue.

### Positive Consequences

- Any task can handle any request, so load balancing is plain round-robin.
- No shared state infrastructure to operate or pay for.
- Scaling out is adding tasks.
- A task can restart without losing client state.

### Negative Consequences

- The cursor must encode all continuation state, which makes it a little longer.
- Nothing can be optimized across calls using server-side context.
- `GET /mcp` returns 405, so clients that only support SSE sessions cannot connect.

## Links

- [Federation and pagination](../architecture/federation.md), the cursor
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
