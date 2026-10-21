---
title: Security model
sources:
  - src/security/
  - src/mcp/registry.ts
  - src/mcp/prompts.ts
  - src/mcp/instructions.ts
  - src/index.ts
  - test/integration/excluded-capabilities.test.ts
  - test/integration/non-public-disclosure.test.ts
verified: 2026-10-21
---

# Security model

The service is anonymous and read-only ([ADR-008](../adr/ADR-008-anonymous-read-only-v1.md)). Its security work is about three things: disclosing only public records (the [canonical gate](./canonical-gate.md)), keeping the attack surface closed, and treating repository content as untrusted data.

## Closed capability surface

The [MCP surface](../reference/mcp-surface.md) is a static table in `src/mcp/registry.ts`. There is no dynamic registration and no write, admin, identity, download, HTTP-fetch, database, or code-execution capability. Every input schema is strict (`additionalProperties: false`), and every tool is annotated `readOnlyHint: true`.

`test/integration/excluded-capabilities.test.ts` fails if the surface grows. Adding a tool, resource, or prompt is a deliberate change: see [Changing the MCP surface](../guides/change-the-mcp-surface.md).

## Edge controls

`edgeMiddleware` and `deadlineMiddleware` in `src/security/index.ts` run on every `/mcp` request.

| Control | Behavior | Setting |
| --- | --- | --- |
| Request ID | A random `x-request-id` is set on the response and carried into logs | |
| Host allowlist | The `Host` header must exactly match an allowed value, else HTTP 403. This defends against DNS rebinding. | `ALLOWED_HOSTS` |
| Origin allowlist | If an `Origin` header is present it must match an allowed value, else HTTP 403. Requests without `Origin` (non-browser clients) pass. | `ALLOWED_ORIGINS` |
| Body size | A `Content-Length` above the limit gets HTTP 413 | `MAX_BODY_BYTES` |
| Deadline | A request still running at the deadline gets HTTP 504 | `TIMEOUT_DEADLINE_MS` (at most 30 s) |
| Tool concurrency | A tool call beyond the in-flight limit fails fast with `rate_limited` | `MAX_TOOL_CONCURRENCY` |

Rejections are JSON-RPC-shaped errors with no internal detail. In deployment, a public load balancer with WAF sits in front of the service; see [Infrastructure](../reference/infrastructure.md).

## Repository content is untrusted

Titles, abstracts, and subjects come from depositors and can contain text written to look like instructions.

- Record metadata is returned only as tool-result data. It is never interpolated into a prompt's instruction text or into server instructions.
- The prompts in `src/mcp/prompts.ts` put user arguments only in the user-role message, inside a fenced data block. The instruction preamble is a constant no argument can change, and it tells the host model to treat repository metadata as data.
- The server instructions in `src/mcp/instructions.ts` are static text, sent in every `initialize` response. Their onward-referral list is maintained in [Related resources](../related-resources.md).

## Backend access

- Solr requests are built only from allowlisted fields and escaped values (`src/adapters/solr-query.ts`), sent as POST form bodies, and refuse redirects.
- Canonical API calls are made as an anonymous caller. The service holds no repository credentials.
- Backends are reached over the private network; the Solr indexes are never exposed to clients.

## Logging

Logs are built field by field from an approved set, never by filtering a payload. Query text, filter values, record metadata, and response bodies cannot reach a log line. See [Observability](./observability.md).
