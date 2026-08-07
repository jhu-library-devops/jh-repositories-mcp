# ADR-010: New Cross-Repository Service Stack

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

The MCP service integrates with both JScholarship and JHRDR but belongs to neither repository alone. We must decide whether to deploy it within an existing repository's infrastructure stack or create an independent stack.

## Decision Drivers

- The MCP belongs to neither repository alone and should be deployable independently
- Requirement 13: Independent ECS cluster, security groups, ALB, and WAF
- Cross-stack security-group rules must avoid circular remote-state dependencies
- Repository stacks should not depend on the MCP stack (one-way reference)
- Independent release cadence from either repository

## Considered Options

1. New cross-repository service stack (independent infrastructure)
2. Deploy within the JScholarship infrastructure stack
3. Deploy within a shared platform infrastructure stack

## Decision Outcome

**Chosen option:** Option 1 — New cross-repository service stack, because the MCP belongs to neither repository alone and should be deployable independently.

### Positive Consequences

- Independent release and deployment cadence
- No coupling to either repository's infrastructure lifecycle
- Clear ownership boundaries and blast radius isolation
- Cross-stack security-group rules are owned by the MCP stack using exported IDs
- Repository stacks expose IDs but do not depend on the MCP stack (no circular dependencies)

### Negative Consequences

- Additional infrastructure to manage (dedicated ALB, cluster, security groups)
- Must read remote state from both repository stacks for VPC, subnets, and SG IDs
- Slightly higher cost from dedicated ALB (accepted for security isolation)
- Coordination required when repository stacks change exported outputs

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table, Infrastructure section
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 13
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 20, 21
- Branch: tofu-iac-starter
