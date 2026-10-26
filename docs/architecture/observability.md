---
title: Observability
sources:
  - src/observability/
  - src/mcp/registry.ts
  - src/mcp/tools/get-item.ts
  - infra/modules/mcp-service/observability.tf
verified: 2026-10-26
---

# Observability

All telemetry is JSON lines on stdout, collected by the container's log driver. `src/observability/index.ts` builds every line, and it builds each one from an approved list of fields rather than by filtering an object. That choice is what keeps query text and record metadata out of the logs.

## Log events

Each line has a `type`.

| `type` | When | Fields |
| --- | --- | --- |
| `tool_invocation` | Once per tool call | `timestamp`, `requestId`, `client` (name and version, when known), `tool`, `repositories`, `latencyMs`, `resultCount`, `partial`, `cache`, `backendStatus`, `outcome`, `build` |
| `backend_fault` | When a backend failure shaped what the client got | `timestamp`, `tool`, `repository`, `operation`, `errorName`, `status`, `effect` |
| `log` | Free-text operational messages | `level`, `timestamp`, `message` (at most 500 characters) |

`backend_fault.effect` is `backend_unavailable` (the client got the opaque error), `files_omitted` (a record was returned without its file list), or `partial_results` (other repositories answered).

### Redaction by construction

The serializers build each line field by field from a fixed set of keys and validate each value. Nothing is copied from an input object, so a field added to an event later cannot leak by accident. In practice:

- Query text, filter values, prompts, record metadata, identifiers, URLs, and response bodies never appear.
- `backend_fault` carries only closed-shape tokens (operation name, error class name, HTTP status) so an operator can find the failing call without seeing data.
- Free-text messages are truncated, and metadata objects passed to `info`, `warn`, or `error` are dropped.

When you add telemetry, add the key to the serializer explicitly and extend the redaction tests rather than logging an object.

## Metrics

Each tool call also emits one CloudWatch Embedded Metric Format line in the `JhuRepositoryMcp` namespace, dimensioned by `Tool`.

| Metric | Unit | Meaning |
| --- | --- | --- |
| `Calls` | Count | Tool calls |
| `Errors` | Count | Calls whose outcome was an error |
| `LatencyMs` | Milliseconds | Call latency |
| `ZeroResults` | Count | Successful calls with no results |
| `PartialResults` | Count | Calls where at least one repository failed |

CloudWatch alarms on CPU, latency, target 5xx responses, and unhealthy tasks are defined in the service module; see [Infrastructure](../reference/infrastructure.md).

## Correlating a request

The edge sets `x-request-id` on every `/mcp` response, and the same value is the `requestId` in that call's `tool_invocation` line.
