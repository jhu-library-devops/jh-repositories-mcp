# ADR-007: Repository-Local Relevance Plus Balanced Reciprocal-Rank Merge

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

When searching both repositories, we must merge two result lists into one ranked response. JScholarship and JHRDR use independently configured Solr instances with different schemas, boost configurations, and document populations. Raw relevance scores from separate indexes are not comparable.

## Decision Drivers

- Requirement 11.1-11.3: Preserve repository-local rank, do not compare raw scores, use balanced merge
- Requirement 4.6: Do not expose raw Solr scores as confidence values
- The two Solr instances have different configurations, document counts, and scoring behavior
- Researchers expect balanced representation from both repositories

## Considered Options

1. Balanced reciprocal-rank fusion with equal default weights and deterministic tie handling
2. Raw score normalization (min-max or z-score across repositories)
3. Interleaving (strict round-robin alternation)
4. Single merged Solr index

## Decision Outcome

**Chosen option:** Option 1 — Repository-local relevance plus balanced reciprocal-rank merge, because raw scores from separately configured Solr indexes are not comparable.

The fusion formula is: `fusionScore = repositoryWeight / (60 + repositoryRank)`

Equal-rank ties use a deterministic alternating source from the Cursor's `nextTieSource`, preventing one repository from always winning ties. A stable namespaced ID is the final tie-breaker.

### Positive Consequences

- Score magnitude and distribution differences between indexes cannot bias results
- Neither repository dominates by virtue of having more documents or different boost configurations
- Deterministic: same input + same index state = same output
- Tie handling alternates fairly and is encoded in the cursor for consistency across pages

### Negative Consequences

- Cannot express "this result is genuinely more relevant across both repositories" (by design)
- Equal weights may not reflect actual collection relevance for all queries (tunable post-pilot)
- Reciprocal-rank fusion is a heuristic; it may not always match human relevance judgments

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table, Component 8
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 11.1-11.3, 4.6
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 10.1, 10.4
- Branch: tofu-iac-starter
