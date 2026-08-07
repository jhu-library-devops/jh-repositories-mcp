# ADR-004: Two Platform-Specific Adapters Behind One Interface

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

JScholarship is DSpace and JHRDR is Dataverse. They have different Solr schemas, metadata models, canonical APIs, access semantics, identifier systems, and field configurations. We must decide how to structure the code that interacts with each platform.

## Decision Drivers

- Requirement 2: JScholarship uses DSpace Discovery configuration and DSpace REST
- Requirement 3: JHRDR preserves Dataverse dataset metadata and DOI semantics
- Requirement 10.2: Every query field mapped through a platform-specific Field Allowlist
- Canonical APIs and access semantics cannot safely be collapsed
- Federation and MCP layers must not name Solr fields or construct repository URLs

## Considered Options

1. Two platform-specific adapters behind one RepositoryAdapter interface
2. Single unified adapter with platform-conditional branches
3. Abstract base class with platform subclasses sharing query logic

## Decision Outcome

**Chosen option:** Option 1 — Two platform-specific adapters behind one interface, because JScholarship is DSpace and JHRDR is Dataverse; canonical APIs and access semantics cannot safely be collapsed below the adapter boundary.

### Positive Consequences

- Clean separation: all platform-specific knowledge stays inside its adapter
- Federation and MCP layers are platform-agnostic
- Each adapter can evolve independently (Dataverse metadata blocks, DSpace Discovery config)
- Solr field names, URL construction, and access rules never leak outside adapter boundaries
- Testing is isolated: fixtures are platform-specific

### Negative Consequences

- Some structural duplication between adapters (search, canonicalize, normalize patterns)
- Adding a third repository means implementing the full interface (by design)
- Shared query builder must be generic enough for both platforms

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table, Component 3
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 2, 3, 9, 10
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 7, 9
- Branch: tofu-iac-starter
