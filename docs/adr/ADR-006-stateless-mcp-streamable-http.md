# ADR-006: Stateless MCP Streamable HTTP with JSON Responses

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

The MCP specification supports both stateful (session-bound) and stateless transports. Our service runs on ECS Fargate with multiple tasks behind an ALB. We must decide whether to maintain server-side session state or operate statelessly.

## Decision Drivers

- Requirement 12.2: No server-side session state, multiple Fargate tasks without sticky sessions
- Requirement 11.4-11.6: All pagination state encoded in opaque client-held Cursor
- ECS Fargate with ALB does not guarantee request affinity
- Operational simplicity: no Redis, no session routing, no sticky sessions

## Considered Options

1. Stateless MCP Streamable HTTP with JSON responses (no session ID)
2. Stateful sessions with Redis/DynamoDB session store
3. Stateful sessions with ALB sticky sessions

## Decision Outcome

**Chosen option:** Option 1 — Stateless MCP Streamable HTTP with JSON responses, because it enables multiple Fargate tasks without sticky sessions, Redis, or session routing.

### Positive Consequences

- Any task can handle any request — simple load balancing
- No shared state infrastructure to operate or pay for
- Horizontal scaling is trivial (add tasks)
- Cursor carries all pagination context; no server memory between requests
- Simpler failure recovery: a task can restart without losing client state

### Negative Consequences

- Cursor must encode all necessary state (increases token size slightly)
- Cannot leverage server-side session context for optimization across calls
- Each request is fully independent — no warm conversation context on the server

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table, Component 1
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 12.1, 12.2, 11.4-11.6
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 2.4, 16.2
- Branch: tofu-iac-starter
