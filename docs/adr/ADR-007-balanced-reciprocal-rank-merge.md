# ADR-007: Repository-Local Relevance Plus Balanced Reciprocal-Rank Merge

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

A search across both repositories has to merge two result lists into one ranked response. JScholarship and JHRDR run independently configured Solr instances with different schemas, boosts, and document populations, so their raw relevance scores are not comparable.

## Decision Drivers

- Preserve each repository's own ranking; never compare raw scores
- Never expose a raw Solr score as a confidence value
- Give researchers balanced representation from both repositories

## Considered Options

1. **Balanced reciprocal-rank fusion with equal weights and deterministic tie handling.** Chosen.
2. **Normalizing raw scores (min-max or z-score) across repositories.** Rejected: normalization assumes the two score distributions mean the same thing, and they do not; a query that matches one repository weakly and the other strongly would still be forced onto one scale.
3. **Strict round-robin interleaving.** Rejected: it ignores rank entirely, so a repository's tenth result would sit beside the other's first.
4. **One merged Solr index.** Rejected: it would require a new indexing pipeline fed from both platforms, and the platforms' own re-index lag is already the problem the canonical gate exists to cover.

## Decision Outcome

Each repository's order is kept as its Repository Rank, and the lists are merged with reciprocal-rank fusion:

```text
fusionScore = repositoryWeight / (60 + repositoryRank)      repositoryWeight = 1
```

Ties use the cursor's `nextTieSource`, which alternates after each tie so neither repository always wins, with the namespaced record ID as the final tie-breaker.

### Positive Consequences

- Differences in score magnitude and distribution cannot bias results.
- Neither repository dominates by having more documents or stronger boosts.
- The merge is deterministic: the same input and index state give the same output.
- Tie handling is fair across pages because the cursor carries it.

### Negative Consequences

- The service cannot say that one result is more relevant than another across repositories. That is intended.
- Equal weights may not reflect each collection's relevance for every query; the weights are tunable.
- Reciprocal-rank fusion is a heuristic and will not always match a human's judgment.

## Links

- [Federation and pagination](../architecture/federation.md), merging rankings
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
