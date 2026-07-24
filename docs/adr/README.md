# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the JScholarship/JHRDR MCP Server project. ADRs capture significant architectural choices — context, decision, and consequences — in [MADR](https://adr.github.io/madr/) format.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](./ADR-001-one-mcp-service-per-environment.md) | One MCP Service per Environment | Accepted | 2024-07-24 |
| [ADR-002](./ADR-002-pinned-bun-with-strict-typescript.md) | Pinned Bun Release with Strict TypeScript | Accepted | 2024-07-24 |
| [ADR-003](./ADR-003-hono-with-mcp-sdk-web-standard-transport.md) | Hono with MCP SDK Web Standard Streamable HTTP Transport | Accepted | 2024-07-24 |
| [ADR-004](./ADR-004-two-platform-specific-adapters.md) | Two Platform-Specific Adapters Behind One Interface | Accepted | 2024-07-24 |
| [ADR-005](./ADR-005-solr-candidates-canonical-api-gate.md) | Direct Private Solr for Candidates, Canonical API for Every Returned Record | Accepted | 2024-07-24 |
| [ADR-006](./ADR-006-stateless-mcp-streamable-http.md) | Stateless MCP Streamable HTTP with JSON Responses | Accepted | 2024-07-24 |
| [ADR-007](./ADR-007-balanced-reciprocal-rank-merge.md) | Repository-Local Relevance Plus Balanced Reciprocal-Rank Merge | Accepted | 2024-07-24 |
| [ADR-008](./ADR-008-anonymous-read-only-v1.md) | Anonymous Read-Only v1 Access Model | Accepted | 2024-07-24 |
| [ADR-009](./ADR-009-host-model-performs-synthesis.md) | Host Model Performs Synthesis | Accepted | 2024-07-24 |
| [ADR-010](./ADR-010-new-cross-repository-service-stack.md) | New Cross-Repository Service Stack | Accepted | 2024-07-24 |

## Source

All initial ADRs were derived from the architectural decisions documented in the [JScholarship/JHRDR MCP Server specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md).
