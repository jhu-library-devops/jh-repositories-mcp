# ADR-009: Host Model Performs Synthesis

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

An MCP server can return raw evidence for the host model to synthesize, or it can embed its own language model or vector search to summarize results, rewrite queries, or expand terms. We had to decide where synthesis lives.

## Decision Drivers

- No embedded language model, generated summaries, vector database, embedding pipeline, or autonomous agent loop in the service
- The service returns attributable evidence; interpretation is the host model's job
- An embedded model would add cost, latency, complexity, and a new failure mode
- Citation accuracy depends on the host working from authoritative source data

## Considered Options

1. **The host model performs synthesis; the server returns evidence only.** Chosen.
2. **An embedded model for query expansion and result summarization.** Rejected: a summary generated inside the service would be returned under the repository's name, and a reader could not tell a canonical abstract from a model's paraphrase of it.
3. **Optional server-side summarization with a raw-data fallback.** Rejected: the same laundering risk as option 2, plus two code paths to secure and test.

## Decision Outcome

The server returns evidence and citations. The host model (HopGPT, Claude, or another) interprets them.

### Positive Consequences

- No model cost, latency, or hallucination risk inside the service.
- Every returned field comes from the canonical API and can be verified.
- The host applies its own reasoning, style, and user context.
- Fewer dependencies and failure modes.
- The service cannot present generated text as repository data.

### Negative Consequences

- Synthesis quality depends entirely on the host model.
- No server-side query expansion; the host refines queries iteratively.
- No "smart" suggestions on zero results without the host's participation.

## Links

- [Concepts](../architecture/concepts.md), MCP for repository engineers
- [Specification](../../.kiro/specs/jscholarship-jhrdr-mcp/design.md) (working record)
