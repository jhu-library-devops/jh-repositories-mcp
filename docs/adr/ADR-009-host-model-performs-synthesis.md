# ADR-009: Host Model Performs Synthesis

**Date:** 2024-07-24
**Status:** Accepted
**Deciders:** Platform engineering, library research services
**Supersedes:** N/A

## Context and Problem Statement

Decision arose during **jscholarship-jhrdr-mcp** (.kiro/specs/jscholarship-jhrdr-mcp/design.md).

MCP servers can either return raw evidence for the host model to synthesize, or embed their own LLM/vector-search to generate summaries, rewrite queries, or expand terms. We must decide where synthesis responsibility lives.

## Decision Drivers

- Requirement 17.2: No embedded LLM, generated summary, vector database, embedding pipeline, or autonomous agent loop
- Requirement 17.5: Host-model synthesis is outside MCP responsibility; return attributable evidence only
- The MCP returns evidence and citations; the host model (HopGPT, Claude, etc.) handles interpretation
- Embedding an LLM would add cost, latency, complexity, and a new failure mode
- Citation accuracy requires the host model to work from authoritative source data

## Considered Options

1. Host model performs synthesis (MCP returns evidence only)
2. Embedded LLM for query expansion and result summarization
3. Hybrid: optional server-side summarization with raw data fallback

## Decision Outcome

**Chosen option:** Option 1 — Host model performs synthesis, because the MCP returns evidence and citations and it does not embed an LLM or vector search system.

### Positive Consequences

- No LLM cost, latency, or hallucination risk inside the MCP service
- Attributable, verifiable results: every field comes from the canonical API
- Host model can apply its own reasoning, style, and user context
- Simpler service with fewer dependencies and failure modes
- No risk of the MCP "laundering" inaccurate AI-generated content as repository data

### Negative Consequences

- Quality of synthesis depends entirely on the host model's capabilities
- No server-side query expansion (host must refine queries iteratively)
- Cannot provide "smart" zero-result suggestions without host model participation

## Links and References

- Spec: .kiro/specs/jscholarship-jhrdr-mcp/design.md — Architectural Decisions table
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/requirements.md — Req 17.2, 17.5
- Spec: .kiro/specs/jscholarship-jhrdr-mcp/tasks.md — Task 15.3
- Branch: tofu-iac-starter
