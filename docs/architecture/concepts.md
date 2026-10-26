---
title: Concepts
sources:
  - src/adapters/index.ts
  - src/mcp/registry.ts
  - src/adapters/jscholarship/
  - src/adapters/jhrdr/
verified: 2026-10-26
---

# Concepts

This service sits between two worlds. People who run repository platforms rarely need to know what the Model Context Protocol is, and people who build MCP servers rarely know what a Handle or a `versionState` is. This page gives each group the two paragraphs it needs about the other. The exact terms the rest of the site uses are in the [glossary](../glossary.md).

## MCP, for repository engineers

The Model Context Protocol is how an AI assistant calls outside systems. A server such as this one advertises a small, fixed list of **tools** (functions the assistant can call, each with a JSON schema for its arguments and its result), **resources** (addressable documents, here one per record), and **prompts** (reusable instruction templates). The assistant's host application, LibreChat or Claude for example, lists those capabilities once, then calls tools as the conversation needs them. The server never sees the conversation. It sees one tool call at a time and answers it.

The practical consequences shape this design. Every tool result goes straight into a language model's context, so the server returns compact, well-labelled data and leaves interpretation to the model ([ADR-009](../adr/ADR-009-host-model-performs-synthesis.md)). Record metadata written by depositors lands in that same context, so the server treats it as untrusted text and never lets it become an instruction ([Security model](./security.md#repository-content-is-untrusted)). And because an assistant can call tools in any order with any arguments, the surface is closed and every argument is validated before it reaches a backend ([MCP surface](../reference/mcp-surface.md)).

## DSpace and Dataverse, for MCP engineers

Both repositories are standard open-source platforms, each with its own data model and its own public API.

**DSpace** (JScholarship) stores *items* in *collections* inside *communities*. An item has Dublin Core metadata (`dc.title`, `dc.contributor.author`, and so on), a UUID, a persistent **Handle** such as `1774.2/12345`, and one or more *bitstreams* (files). An item can be withdrawn, hidden from discovery, or still in a submission workflow. Only an archived, discoverable, non-withdrawn item that anonymous users may read is public.

**Dataverse** (JHRDR) stores *datasets* in nested *dataverses* (collections). A dataset has metadata organized in *blocks*, a persistent identifier that is usually a **DOI**, and numbered *versions*. A dataset is public only when it has a released version that has not been deaccessioned, and individual files inside a public dataset can still be restricted.

Each platform also keeps a private **Solr** index for its own search page. Solr is fast and supports facets and "more like this" queries, which is why this service reads it for candidates. But the index lags the platform, and its copy of the access flags is not what the platform enforces. That gap is the reason for the service's central rule: Solr may propose a record, but only the platform's public API, asked anonymously, may confirm it ([Canonical gate](./canonical-gate.md)). The two platforms' notions of "public" differ enough that the service checks each one separately rather than pretending they are the same ([ADR-004](../adr/ADR-004-two-platform-specific-adapters.md)).

## How the two meet

An assistant asks for "datasets about X". The server turns that into an allowlisted Solr query per repository, confirms each candidate through DSpace REST or the Dataverse Native API, merges the confirmed records by rank, and hands back a page with a cursor for the next one. The [overview](./overview.md) follows that request through the code.
