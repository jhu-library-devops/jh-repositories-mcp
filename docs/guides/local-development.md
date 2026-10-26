---
title: Local development
sources:
  - package.json
  - .bun-version
  - src/config/env.ts
  - src/index.ts
  - compose.yaml
verified: 2026-10-26
---

# Local development

## Prerequisites

- Bun at the version pinned in `.bun-version`. CI uses exactly that version.
- Git.
- To regenerate the infrastructure reference: [terraform-docs](https://terraform-docs.io/user-guide/installation/) at the version pinned in `scripts/docs/generators/infrastructure.ts`.

## Install and verify

Run these in order and stop at the first failure.

```bash
bun install --frozen-lockfile   # installs exactly what bun.lock records
bun run typecheck               # tsc --noEmit; Bun's bundler does not type-check
bun test                        # unit, property, contract, and integration suites
bun run lint                    # Biome
bun run build                   # bundle to dist/
```

## Run the server

Configuration is validated at startup, so `bun run dev` with no environment exits immediately and lists every missing variable. The smallest working set:

```bash
ENVIRONMENT=stage BUILD_VERSION=dev BUILD_COMMIT=local \
JSCHOLARSHIP_SOLR_URL=http://localhost:8983/solr/search \
JSCHOLARSHIP_API_URL=http://localhost:8080/server/api \
JSCHOLARSHIP_PUBLIC_URL=https://jscholarship.library.jhu.edu \
ALLOWED_HOSTS=localhost:3000 \
bun run dev
```

`bun run dev` restarts on file changes. Every variable, its default, and its meaning is in [Configuration](../reference/configuration.md).

`ALLOWED_HOSTS` is compared with the exact `Host` header, including the port, so `localhost:3000` is what a local client sends.

Leaving the `JHRDR_*` URLs unset is normal: the server then serves JScholarship only.

## Run against a local stack

`compose.yaml` runs the server against either a fixture-backed mock (`docker compose --profile mock up --build`) or real DSpace and Dataverse containers sharing one SolrCloud (`--profile real`). The mock is for exercising the assembled server quickly; it replays canned Solr pages, so filters, sorting, and paging are not exercised. The real profile is empty until you load records. Setup and loading steps are in `dev/README.md` in the repository.

## Check health

```bash
curl -i http://localhost:3000/health/live    # 200: the process is up
curl -i http://localhost:3000/health/ready   # 503 until Solr schema validation passes
```

Without a reachable Solr, readiness stays 503 and its body explains why. `/mcp` still answers: `tools/list` and `explain_search` work, and tools that query a backend fail with `backend_unavailable`.

## Call the MCP endpoint

The transport is stateless JSON over `POST /mcp`. List the tools:

```bash
curl -s http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Any MCP client that supports Streamable HTTP can connect to `http://localhost:3000/mcp`. Clients that only support SSE sessions cannot, because `GET /mcp` returns 405.

## Common commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run with hot reload |
| `bun test` | All test suites |
| `bun test test/property` | One suite |
| `bun run typecheck` | Strict type check |
| `bun run lint` / `bun run format` | Check or apply Biome formatting and lint rules |
| `bun run docs:generate` | Regenerate the reference pages and injected regions |
| `bun run docs:check` | Lint docs, validate links and cited paths, check generated output |
| `bun run docs:dev` | Preview this site locally |
| `bun run changelog:new` | Add a release-note fragment to `changelog.d/` |
