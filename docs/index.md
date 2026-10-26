---
layout: home
title: Developer reference
sources:
  - src/index.ts
  - src/mcp/registry.ts
verified: 2026-10-26
hero:
  name: JHU Repositories MCP
  text: Search and cite JHU repositories from an AI assistant
  tagline: A read-only Model Context Protocol server over JScholarship and JHRDR. It returns only records the repositories themselves confirm are public.
  actions:
    - theme: brand
      text: How it works
      link: /architecture/overview
    - theme: alt
      text: Run it locally
      link: /guides/local-development
    - theme: alt
      text: MCP surface
      link: /reference/mcp-surface
features:
  - title: Understand it
    details: Start with Concepts if one half of the stack is new to you, then the overview and the canonical gate.
    link: /architecture/concepts
  - title: Change it
    details: Run the server, add a filter or a repository, and write the tests that keep the disclosure guarantee intact.
    link: /guides/local-development
  - title: Operate it
    details: Configure, deploy, roll back, and read the logs when something goes wrong.
    link: /guides/deploy-and-rollback
  - title: Look it up
    details: Every tool, schema, variable, error code, and infrastructure input, generated from the code.
    link: /reference/mcp-surface
---

# What this is

`jh-repositories-mcp` gives AI research assistants one search interface over two Johns Hopkins repositories that run on different platforms:

| Repository | Holds | Platform |
| --- | --- | --- |
| **JScholarship** | Theses, dissertations, articles, and reports | DSpace |
| **JHRDR**, the Johns Hopkins Research Data Repository | Research datasets | Dataverse |

An assistant connected to the server can search both at once, page through merged results, fetch one record with its citation and public file list, find related records, and ask how a query would be interpreted before running it. Every record it returns was confirmed public by the repository's own API moments before it was sent.

## What it is not

The server is anonymous and read-only. It has no accounts, no writes, no file downloads, no embedded language model, and no vector search. The assistant does the reasoning; the server supplies evidence with persistent identifiers to cite. Those limits are deliberate, and the [decision records](./adr/README.md) explain each one.

## Where to start

- **New to MCP, or new to DSpace and Dataverse?** Read [Concepts](./architecture/concepts.md) first. It explains each half of the stack for people who know the other half.
- **About to change code?** Read the [overview](./architecture/overview.md), then the [canonical gate](./architecture/canonical-gate.md). Everything else in the design follows from the gate.
- **Running or debugging a deployment?** Go to [Deploy and roll back](./guides/deploy-and-rollback.md) and [Troubleshooting](./guides/troubleshooting.md).
- **Need an exact schema, default, or error code?** The [reference](./reference/mcp-surface.md) pages are generated from the code and checked in CI, so they are always current.

The site describes the service as built. If a page and the code disagree, the code is right. [Maintain these docs](./guides/maintaining-docs.md) explains how to report or fix the page.
