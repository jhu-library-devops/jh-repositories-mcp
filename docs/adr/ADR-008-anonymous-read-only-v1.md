# ADR-008: Anonymous Read-Only v1 Access Model

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services, security
**Supersedes:** N/A

## Context and Problem Statement

The server is publicly reachable so that AI research assistants can discover JHU repository content. We had to decide whether the first release requires authentication and authorization, or operates anonymously.

## Decision Drivers

- No repository credentials, API tokens, or user identity attributes in the service
- A disciplined first release that defers higher-risk capabilities
- Both repositories already publish their public material without authentication
- Authentication would add friction to the pilot without exposing any more data

## Considered Options

1. **Anonymous, read-only.** Chosen.
2. **An API key per client.** Rejected: a key would identify a client without authorizing it to see anything more, so it adds key issuance and rotation for no change in what the service may return.
3. **OAuth 2.0 with user identity.** Rejected: token management, session handling, and consent flows are a large build, and the only payoff, access to restricted content, is explicitly out of scope for the first release.

## Decision Outcome

The first release is anonymous and read-only. Access to anything beyond public records requires a new specification.

### Positive Consequences

- Any MCP client can connect with only the server URL.
- No credential management, token rotation, or session infrastructure.
- A simpler security model: the WAF, rate limits, and concurrency bounds provide abuse protection.
- A clear scope boundary.

### Negative Consequences

- No user-specific results or personalization.
- No access to restricted or embargoed content.
- Abuse protection rests entirely on network controls.
- No audit trail of who is calling, beyond IP-level visibility.

## Links

- [Security model](../architecture/security.md)
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
