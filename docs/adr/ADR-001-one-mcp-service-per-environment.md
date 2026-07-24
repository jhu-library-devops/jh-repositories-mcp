# ADR-001: One MCP Service per Environment

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

The MCP server needs to reach both JScholarship (DSpace) and JHRDR (Dataverse) backends — their Solr indexes and canonical REST/Native APIs. These deployments share a VPC and private subnets. We must decide whether to deploy one combined service, separate gateway + adapter services, or one service per repository.

## Decision Drivers

- Requirement 13: Fargate deployment in private subnets shared by both repositories
- Both repository deployments already occupy the same VPC and private subnets
- Operational simplicity vs. independent scaling
- Network proximity to both Solr clusters and canonical APIs

## Considered Options

1. One MCP service per environment (combined)
2. Gateway service + separate adapter microservices per repository
3. One independent MCP service per repository

## Decision Outcome

**Chosen option:** Option 1 — One MCP service per environment, because both repository deployments use the same VPC and private subnets, so a gateway plus remote adapter services would add operational complexity without a network benefit.

### Positive Consequences

- Single deployment unit simplifies operations, monitoring, and rollbacks
- No inter-service latency for federated queries
- Shared concurrency controls and caching within one process
- Fewer infrastructure resources (one ALB, one service, one set of security groups)

### Negative Consequences

- Both adapters must be deployed together; a breaking change in one blocks the other
- Cannot independently scale adapters if load is asymmetric
- Single failure domain for both repository integrations (mitigated by partial-result behavior)

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 13
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 20
- Branch: tofu-iac-starter
