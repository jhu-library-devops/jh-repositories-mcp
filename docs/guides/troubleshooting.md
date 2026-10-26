---
title: Troubleshooting
sources:
  - src/index.ts
  - src/config/env.ts
  - src/security/index.ts
  - src/mcp/transport.ts
  - src/mcp/tools/search-items.ts
  - src/federation/service.ts
  - src/adapters/registry.ts
  - src/observability/index.ts
verified: 2026-10-26
---

# Troubleshooting

Find your symptom below and follow the row. Codes and messages are explained in [Errors and warnings](../reference/errors.md); log fields in [Observability](../architecture/observability.md).

## The process exits at startup

The log starts with `Environment configuration validation failed:` and lists every invalid variable. Set or fix each one; see [Configuration](../reference/configuration.md).

If the JHRDR variables are set to a malformed non-empty value, the process can also exit while constructing the JHRDR adapter, after configuration validation has passed. `JHRDR_SOLR_URL` and `JHRDR_API_URL` are not URL-validated; see [Known limitations](../architecture/known-limitations.md#jhrdr-urls-are-not-validated-at-startup).

## `/health/ready` returns 503

The response body says why.

| `reason` | Cause | Fix |
| --- | --- | --- |
| `Adapter registry has not been built` | Startup is still registering adapters | Wait, then retry |
| Any message with a `code` such as `all_adapters_schema_invalid` or `duplicate_repository_id` | The adapter registry could not be built; the process is exiting | Read the `[startup]` log line; see [Federation and pagination](../architecture/federation.md#the-adapter-registry) |
| `Schema validation has not completed` | Startup validation is still running | Wait, then retry |
| `Schema validation error: …` | Solr could not be reached or answered with an error | Check the Solr URL, network path, and security groups |
| `Schema validation failed for: <repository>` | A field in that profile's `requiredSchemaFields` is missing from the deployed Solr schema | Compare the profile in `config/repositories/` with the deployed schema; `results` lists what is missing |
| `Draining: SIGTERM received` | The task is shutting down | None |

## Every `/mcp` request gets 403

- `Forbidden host`: the `Host` header must exactly match an `ALLOWED_HOSTS` entry, including any port.
- `Forbidden origin`: the request carries an `Origin` header not in `ALLOWED_ORIGINS`. Browser-based clients need their origin listed; non-browser clients should send no `Origin`.

## Other HTTP errors from `/mcp`

| Status | Cause |
| --- | --- |
| 405 | `GET` or `DELETE`. The transport is stateless and serves `POST` only, so SSE-only clients cannot connect. |
| 413 | `Content-Length` above `MAX_BODY_BYTES` |
| 504 | The request ran past `TIMEOUT_DEADLINE_MS` |

## Tool results look wrong

| Symptom | Likely cause |
| --- | --- |
| `backend_unavailable` on every call | No requested repository answered. Check `backend_fault` log lines for the failing `operation` and HTTP `status`. |
| Results from some repositories only, with a `backend_unavailable` warning per missing one | A partial result: the named repositories failed; `repositories.failed` lists them. |
| `invalid_input: … is not available on this server` | The requested repository's adapter is not configured in this deployment (for example, JHRDR URLs unset). The message lists the repositories that are. |
| Fewer results than `limit`, with `validation_attrition` | Candidates the canonical API did not confirm as public were dropped. |
| `unsupported_filter` warning | That repository does not support the filter or facet; see the matrices in [Repositories](../reference/repositories.md). |
| `cursor_reset` warning | The cursor came from a different query, or named a repository no longer in the selection; pagination restarted. |
| `cursor_expanded` warning | A repository joined the selection since the cursor was issued; it starts from its first page while the others continue. |
| `deadline_exceeded` warning | The 10 s federation deadline passed with some repositories still working; the result holds what had arrived. |
| `rate_limited` | The task is at `MAX_TOOL_CONCURRENCY` in-flight calls. |
| A withdrawn record still appears in search | Search-page cache hits are not revalidated; it disappears when the entry expires (`CACHE_SEARCH_TTL_MS`). Single-record lookups re-check immediately. See [Canonical gate](../architecture/canonical-gate.md#caching). |
| `get_item` returns a record with `filesStatus: "unavailable"` | Metadata resolved but the file list could not be loaded. The record is not cached, so the next call retries. |

## Finding the log line for a request

Take the `x-request-id` response header and search the logs for that `requestId` in a `tool_invocation` line.
