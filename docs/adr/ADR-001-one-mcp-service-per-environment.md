# ADR-001: One MCP Service per Environment

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

The MCP server needs to reach both JScholarship (DSpace) and JHRDR (Dataverse): their Solr indexes and their canonical APIs. Both repository deployments already share one VPC and the same private subnets. We had to decide whether to deploy one combined service, a gateway with a separate adapter service per repository, or one independent service per repository.

## Decision Drivers

- Fargate deployment in the private subnets the two repositories already share
- Network proximity to both Solr clusters and both canonical APIs
- Operational simplicity, weighed against independent scaling

## Considered Options

1. **One MCP service per environment (combined).** Chosen.
2. **A gateway service plus one adapter service per repository.** Rejected: the adapters would sit in the same subnets as the gateway, so the extra hop buys no network benefit and adds a deployment, a service discovery dependency, and a failure mode between the two.
3. **One independent MCP service per repository.** Rejected: federation would then need a fourth component to merge results, and the client would face two endpoints for what is meant to be one search.

## Decision Outcome

One MCP service per environment. Both adapters run in one process, and that process is deployed once per environment.

### Positive Consequences

- A single deployment unit simplifies operations, monitoring, and rollback.
- No inter-service latency inside a federated query.
- Concurrency controls and caches are shared within one process.
- Fewer resources: one load balancer, one service, one set of security groups.

### Negative Consequences

- Both adapters deploy together, so a breaking change in one blocks the other.
- The adapters cannot scale independently when load is asymmetric.
- One failure domain covers both integrations. Partial-result behavior limits the blast radius: when one repository fails, the other still answers.

## Links

- [Architecture overview](../architecture/overview.md), deployment topology
- [Deploy and roll back](../guides/deploy-and-rollback.md)
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
