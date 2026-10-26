---
title: Run the server locally
sources:
  - package.json
  - .bun-version
  - src/config/env.ts
  - src/index.ts
verified: 2026-10-26
---

# Run the server locally

This guide takes you from a fresh clone to a server answering `tools/list`. It is the one place the setup commands live; other pages link here rather than repeating them.

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

Configuration is validated at startup, so `bun run dev` with no environment exits immediately and lists every missing variable. That is the intended behavior, not a crash. The smallest working set:

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

## Run against a local stack

`compose.yaml` runs the server against either of two backends. Choose one profile per run; both publish the server on port 3000, so a second profile fails to bind.

```bash
docker compose --profile mock up --build   # replays recorded fixtures, ready in seconds
docker compose --profile real up --build   # DSpace and Dataverse, ready in minutes
```

Use the `mock` profile to exercise the assembled server: transport, tool schemas, and canonical resolution by UUID, Handle, or DOI. Do not use it to judge search behavior. Every Solr `/select` returns the same page whatever the query, so a broken filter, sort, or cursor still appears to work. The mock serves only the sanitized records under `test/fixtures/` and never enforces the public filters; the integration suites cover those.

The `real` profile runs DSpace, Dataverse, one Postgres instance, and one SolrCloud that serves both repositories, as the deployed stack does. The SolrCloud has two Solr nodes on a three-node ZooKeeper ensemble, and every collection has a replica on each Solr node, so stopping one node does not take a collection offline. The Postgres instance holds two databases with separate roles, so the platforms share no tables; it runs version 17 because Dataverse requires that or later, and a volume created before the Dataverse database existed leaves Dataverse unable to connect until you delete it with `docker compose --profile real down -v`. Each Solr collection belongs to one platform and has its own configset, so no collection is shared; a collection that already exists with a different configset stops provisioning rather than being adopted. Start it with Compose and not by launching the server on its own: schema validation runs once at startup, so a server that starts before the collections exist stays at 503 on `/health/ready` until you restart it. Compose holds the server until provisioning finishes.

The `real` profile starts empty, and the server returns only records that are public and validated through the platform API, so load at least one published record into each repository before you search. Stock DSpace and Dataverse schemas can differ from the customized deployments the repository profiles describe; a missing required field leaves readiness at 503 and the response body names it. The image tags (`DSPACE_TAG`, `DATAVERSE_TAG`, `SOLR_TAG`), the steps for loading records, and the known caveats are in `dev/README.md`.

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

## Next

- To understand what you just started, read the [overview](../architecture/overview.md).
- To make a change, see [Change the MCP surface](./change-the-mcp-surface.md), [Add a repository](./add-a-repository.md), and [Write tests and fixtures](./testing-and-fixtures.md).
