# ADR-010: New Cross-Repository Service Stack

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

The service integrates with both JScholarship and JHRDR but belongs to neither. We had to decide whether to deploy it inside an existing repository's infrastructure stack or to give it a stack of its own.

## Decision Drivers

- The service belongs to neither repository and should deploy independently
- Its own ECS cluster, security groups, load balancer, and WAF
- Cross-stack security-group rules without circular remote-state dependencies
- Repository stacks must not depend on the MCP stack
- A release cadence independent of either repository

## Considered Options

1. **A new, independent cross-repository stack.** Chosen.
2. **Deploy inside the JScholarship stack.** Rejected: a JHRDR-only change would then ship through the JScholarship pipeline, and a JScholarship infrastructure change could take the JHRDR integration down with it.
3. **Deploy inside a shared platform stack.** Rejected: no such stack existed, and creating one for a single service is this option under another name.

## Decision Outcome

The service has its own OpenTofu stack: a shared layer (IAM, load balancer, WAF) and one service per environment. It reads the repository stacks' exported outputs (VPC, subnets, security-group IDs) and owns the cross-stack ingress rules itself, so the dependency runs one way.

### Positive Consequences

- Independent release and deployment cadence.
- No coupling to either repository's infrastructure lifecycle.
- Clear ownership and blast-radius isolation.
- The MCP stack owns the cross-stack rules; the repository stacks export IDs and depend on nothing.

### Negative Consequences

- More infrastructure to manage: a dedicated load balancer, cluster, and security groups.
- Remote state from both repository stacks is read at plan time.
- A dedicated load balancer costs more. Accepted for the isolation.
- Changes to the repository stacks' exported outputs need coordination.

## Links

- [Architecture overview](../architecture/overview.md), deployment topology
- [Infrastructure](../reference/infrastructure.md)
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
