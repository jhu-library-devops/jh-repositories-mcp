# ADR-004: Two Platform-Specific Adapters Behind One Interface

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

JScholarship is DSpace and JHRDR is Dataverse. They have different Solr schemas, metadata models, canonical APIs, access semantics, identifier systems, and field configurations. We had to decide how to structure the code that talks to each platform.

## Decision Drivers

- JScholarship follows DSpace Discovery configuration and resolves through DSpace REST
- JHRDR preserves Dataverse dataset metadata and DOI semantics
- Every query field maps through a platform-specific field allowlist
- The two platforms' access rules cannot safely be collapsed into one check
- The federation and MCP layers must not name Solr fields or construct repository URLs

## Considered Options

1. **Two platform-specific adapters behind one `RepositoryAdapter` interface.** Chosen.
2. **One adapter with platform-conditional branches.** Rejected: the public check is the most security-sensitive code in the service, and a shared function full of `if (platform === …)` branches is where a DSpace assumption would quietly be applied to Dataverse.
3. **An abstract base class with platform subclasses sharing query logic.** Rejected: inheritance would invite a shared `isPublic()` in the base class, which is exactly the thing that must not exist; composition of shared helpers gives the reuse without the shared semantics.

## Decision Outcome

Each platform implements `RepositoryAdapter` in its own directory, with its own client and its own public check. Shared helpers (the query builder, `canonicalizeInOrder`, caching) are composed in, not inherited.

### Positive Consequences

- All platform-specific knowledge stays inside its adapter.
- The federation and MCP layers are platform-agnostic.
- Each adapter can evolve with its platform: Dataverse metadata blocks, DSpace Discovery configuration.
- Solr field names, URL construction, and access rules never leak past the adapter boundary.
- Fixtures and tests are platform-specific and isolated.

### Negative Consequences

- Some structure repeats between adapters (search, canonicalize, normalize).
- A third repository means implementing the whole interface. That is intended.
- The shared query builder has to be generic enough for both platforms.

## Links

- [Architecture overview](../architecture/overview.md), the adapter seam
- [Add a repository](../guides/add-a-repository.md)
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
