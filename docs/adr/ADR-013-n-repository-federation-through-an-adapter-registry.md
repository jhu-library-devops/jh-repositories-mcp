# ADR-013: N-Repository Federation Through an Adapter Registry

**Date:** 2026-10-21
**Status:** Accepted. Amends [ADR-006](./ADR-006-stateless-mcp-streamable-http.md), [ADR-007](./ADR-007-balanced-reciprocal-rank-merge.md), and [ADR-012](./ADR-012-cursor-mismatch-resets-instead-of-errors.md).
**Deciders:** Platform engineering
**Supersedes:** N/A

## Context and Problem Statement

The first federation layer was written for exactly two repositories. The cursor carried two named offsets (`jsOffset`, `dvOffset`), the tie-break flipped between two sources, the merge walked two pointers, and several schemas bounded repository lists at two. Adding a third repository would have meant a new cursor version and a rewrite of the merge, not only a new adapter ([ADR-004](./ADR-004-two-platform-specific-adapters.md) promised the adapter would be enough). We had to decide how to generalize without breaking clients that hold version 1 cursors or send the existing `repositories` values.

## Decision Drivers

- A new repository should need an adapter, a profile, and registration, with no change to the merge
- Clients holding a version 1 cursor must keep paginating
- `all`, a single ID, and omission must keep their meaning
- The federation layer must still name no repository
- Fan-out across more repositories must stay bounded in canonical API calls and in time

## Considered Options

1. **An adapter registry built at startup, a variable-length cursor, and an N-way merge driven by the registry.** Chosen.
2. **Keep the two-repository code and add a third set of named fields when a third repository arrives.** Rejected: every new repository would be a cursor version and a merge change, which is the cost the adapter seam was meant to remove.
3. **Generalize the merge but keep server-side pagination state per client.** Rejected: it would reintroduce the session store that [ADR-006](./ADR-006-stateless-mcp-streamable-http.md) declined, to solve a problem the cursor can carry.

## Decision Outcome

Adapters are registered at startup into an immutable registry that records each one's fusion weight and dispatch eligibility. The federation pipeline resolves the selected set through the registry, allocates a per-repository fetch window under a total canonicalization budget, dispatches under one deadline, merges with weighted reciprocal-rank fusion and a round-robin tie sequence over the participating set, and emits a version 2 cursor carrying one offset per contributing repository, the participating set, and the tie position. Version 1 cursors decode and map onto that shape. The `repositories` selector additionally accepts an array; a selector naming an unregistered ID is rejected before any backend call. Two warning codes are added: `cursor_expanded`, when a repository joins the selection mid-pagination, and `deadline_exceeded`, when the deadline passes with partial results.

### What this amends

- ADR-006: the cursor is still the only pagination state, but its shape is now variable-length and versioned, with version 1 still accepted.
- ADR-007: the fusion formula gains a configurable `k` and per-repository weights (default 60 and 1.0, which reproduce the earlier behavior), and the two-way tie flip becomes a ring over the participating set.
- ADR-012: the reset-on-mismatch rule stands, and gains two cases: a cursor naming a repository no longer participating also resets, while a newly participating repository starts from zero with `cursor_expanded` rather than resetting the others.

### Positive Consequences

- Adding a repository is an adapter, a profile, and a registration.
- With the original two repositories at equal weights, ordering, offsets, and warning codes match the earlier implementation.
- Fan-out is bounded: a wide selection cannot multiply canonical API calls past the budget or run past the deadline.
- The participating set travels in the cursor, so the server can tell a changed selection from a changed query and respond differently.

### Negative Consequences

- The cursor is longer, and its size now depends on the number of registered repositories; the registry refuses a set whose cursor could exceed 2048 bytes.
- The limits (`k`, budget, deadline, weights, maximum adapters) exist in code but are not yet read from configuration, and the N-way facet merge is not yet wired to `list_facets`. See [Known limitations](../architecture/known-limitations.md).
- A second deadline, inside the federation pipeline, sits beneath the edge deadline; the two have to be understood together.

## Links

- [Federation and pagination](../architecture/federation.md)
- [Add a repository](../guides/add-a-repository.md)
- [Specification](../../.kiro/specs/n-repository-federation/design.md) (working record)
