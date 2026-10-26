# ADR-012: Cursor Hash Mismatch Resets Pagination Instead of Returning an Error

**Date:** 2024-07-24
**Status:** Accepted. Amended by [ADR-013](./ADR-013-n-repository-federation-through-an-adapter-registry.md).
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

A cursor is bound to the normalized query that produced it. When a client sends a cursor with a different query, filters, sort, or limit, the offsets inside it are meaningless for the new request. We had to decide how the server responds.

## Decision Drivers

- AI host models refine a search between calls and may pass the previous query's cursor
- A hard error from a tool tends to put a model into a retry loop
- Stale offsets must never produce nonsensical results

## Considered Options

1. **Reject a mismatched cursor as `invalid_input`.** Rejected: strict, but a model that changed one filter and re-sent its cursor would get an error, retry with the same cursor, and get the same error.
2. **Reset the offsets, return the first page of the new query, and add a `cursor_reset` warning.** Chosen.
3. **Treat the cursor as advisory and use its offsets regardless.** Rejected: it would apply one query's offsets to another's results, skipping or repeating records.

## Decision Outcome

A well-formed cursor whose hash does not match the request resets pagination to the first page of the new query, with a `cursor_reset` warning so the reset is visible. Malformed cursors and unknown versions are still `invalid_input`; only a hash mismatch gets the reset.

### Positive Consequences

- Stale cursors cannot produce wrong pages.
- Models without cursor-management logic recover on their own.
- The warning keeps the reset observable, and the `explore_research_topic` prompt tells models to drop the cursor when they refine a query.

### Negative Consequences

- A client that changed its query by accident gets page one instead of an error, and has to notice the warning.

## Links

- [Federation and pagination](../architecture/federation.md), the cursor
- [Errors and warnings](../reference/errors.md#warning-codes)
