---
layout: home
title: Developer reference
sources:
  - src/index.ts
  - src/mcp/registry.ts
verified: 2026-10-21
hero:
  name: JHU Repositories MCP
  text: Developer reference
  tagline: A read-only Model Context Protocol server for searching and citing public records in JScholarship and JHRDR.
  actions:
    - theme: brand
      text: Architecture overview
      link: /architecture/overview
    - theme: alt
      text: MCP surface
      link: /reference/mcp-surface
    - theme: alt
      text: Run it locally
      link: /guides/local-development
features:
  - title: Reference
    details: Tools, schemas, configuration, repository capabilities, errors, and infrastructure. Generated from source and checked in CI.
    link: /reference/mcp-surface
  - title: Architecture
    details: The adapter seam, the canonical gate, federation and cursors, and the security model.
    link: /architecture/overview
  - title: Guides
    details: Running locally, adding a repository, changing the MCP surface, testing, deploying, and troubleshooting.
    link: /guides/local-development
  - title: Decisions
    details: Architecture decision records explaining why each structural choice was made.
    link: /adr/
---

# About this reference

This site describes `jh-repositories-mcp` as it is built today. It covers interfaces, behavior, and how to extend and operate the service. Plans and history live elsewhere: release notes in [`CHANGELOG.md`](../CHANGELOG.md), and design intent in the project's specifications.

## How the pages are kept current

- Pages under **Reference** are generated from the code by `bun run docs:generate`. CI fails when they are out of date.
- Every other page names the source files it describes. When those files change, the pull request gets an advisory comment listing the pages to recheck, and a weekly sweep flags pages whose sources changed since they were last verified.

See [Maintaining these docs](./guides/maintaining-docs.md) for the details.

## When sources disagree

The code is the ground truth. If a page and the code disagree, the code wins: open an issue or fix the page.
