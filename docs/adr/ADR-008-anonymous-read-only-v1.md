# ADR-008: Anonymous Read-Only v1 Access Model

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services, security
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

The MCP server will be publicly accessible for AI research assistants to discover JHU repository content. We must decide whether v1 requires authentication/authorization or operates anonymously.

## Decision Drivers

- Requirement 14.1: No repository credentials, API tokens, or user identity attributes
- Requirement 17: Disciplined first release; higher-risk capabilities deferred
- Both repositories publish public material accessible without authentication
- Adding authentication would increase friction for the pilot without expanding available data
- OAuth adds significant complexity (token management, session handling, consent flows)

## Considered Options

1. Anonymous, read-only v1 (no authentication)
2. API key required for access
3. OAuth 2.0 with user identity

## Decision Outcome

**Chosen option:** Option 1 — Anonymous, read-only v1, because both repositories publish public material and authentication would add friction without expanding authorized data.

### Positive Consequences

- Zero-friction pilot: any MCP client can connect with just the server URL
- No credential management, token rotation, or session infrastructure
- Simpler security model: WAF rate limits and concurrency bounds provide abuse protection
- Clear scope boundary: if protected data is needed later, it requires a new specification

### Negative Consequences

- Cannot offer user-specific results or personalization
- Cannot access restricted or embargoed content (accepted limitation for v1)
- Abuse protection relies entirely on network controls (WAF, rate limits, concurrency)
- No audit trail of who is making requests (only IP-level visibility)

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table, Security Design
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 14.1, 14.7, 17
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 21, 16.4
- Branch: tofu-iac-starter
