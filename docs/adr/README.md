# Architecture Decision Records

Each record here captures one structural choice: the situation, the options that were weighed and why the others lost, the decision, and what it costs. They follow the [MADR](https://adr.github.io/madr/) format. Records are append-only: to change a decision, add a new record that supersedes the old one.

Read [ADR-005](./ADR-005-solr-candidates-canonical-api-gate.md) first. Most of the others follow from it.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](./ADR-001-one-mcp-service-per-environment.md) | One MCP Service per Environment | Accepted | 2024-07-24 |
| [ADR-002](./ADR-002-pinned-bun-with-strict-typescript.md) | Pinned Bun Release with Strict TypeScript | Accepted | 2024-07-24 |
| [ADR-003](./ADR-003-hono-with-mcp-sdk-web-standard-transport.md) | Hono with MCP SDK Web Standard Streamable HTTP Transport | Accepted | 2024-07-24 |
| [ADR-004](./ADR-004-two-platform-specific-adapters.md) | Two Platform-Specific Adapters Behind One Interface | Accepted | 2024-07-24 |
| [ADR-005](./ADR-005-solr-candidates-canonical-api-gate.md) | Direct Private Solr for Candidates, Canonical API for Every Returned Record | Accepted | 2024-07-24 |
| [ADR-006](./ADR-006-stateless-mcp-streamable-http.md) | Stateless MCP Streamable HTTP with JSON Responses | Accepted; amended by 013 | 2024-07-24 |
| [ADR-007](./ADR-007-balanced-reciprocal-rank-merge.md) | Repository-Local Relevance Plus Balanced Reciprocal-Rank Merge | Accepted; amended by 013 | 2024-07-24 |
| [ADR-008](./ADR-008-anonymous-read-only-v1.md) | Anonymous Read-Only v1 Access Model | Accepted | 2024-07-24 |
| [ADR-009](./ADR-009-host-model-performs-synthesis.md) | Host Model Performs Synthesis | Accepted | 2024-07-24 |
| [ADR-010](./ADR-010-new-cross-repository-service-stack.md) | New Cross-Repository Service Stack | Accepted | 2024-07-24 |
| [ADR-011](./ADR-011-search-cache-never-bypasses-canonical-gate.md) | Search Cache Never Bypasses the Canonical API Gate | Accepted; implementation differs | 2024-07-24 |
| [ADR-012](./ADR-012-cursor-mismatch-resets-instead-of-errors.md) | Cursor Hash Mismatch Resets Pagination Instead of Returning an Error | Accepted; amended by 013 | 2024-07-24 |
| [ADR-013](./ADR-013-n-repository-federation-through-an-adapter-registry.md) | N-Repository Federation Through an Adapter Registry | Accepted | 2026-10-21 |
| [ADR-014](./ADR-014-local-stack-mirrors-deployed-topology.md) | Local Test Environment Mirrors the Deployed Solr and Postgres Topology | Accepted | 2026-10-26 |

## Source

The initial records were written from the architectural decisions in the project [specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md), which remains the working record for intent and scope. Later records cite the specification of the feature that prompted them.
