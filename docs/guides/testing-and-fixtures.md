---
title: Write tests and fixtures
sources:
  - test/
  - bunfig.toml
  - package.json
verified: 2026-10-26
---

# Write tests and fixtures

`bun test` runs every suite. Test files are named `*.test.ts`. The directories under `test/` are kinds of test, and each kind answers a different question.

| Directory | Tests | Use it for |
| --- | --- | --- |
| `test/unit/` | One module, no I/O | Translation, parsing, formatting, configuration |
| `test/property/` | Invariants as `fast-check` generated cases, **at least 100 per property** | Any guarantee you can state as "for every input…": allowlisted fields, escaping, ID namespacing, cursor round-trips, prompt fencing |
| `test/contract/` | Platform clients against recorded fixtures | The shape of DSpace REST and Dataverse Native API responses |
| `test/integration/` | The assembled server | Tool behavior end to end, plus the guardrail suites below |
| `test/spike/` | Profiles against the recorded schema findings | Keeping a profile consistent with what the deployed schema is known to contain |
| `test/fixtures/` | Sanitized payloads | Inputs for contract and integration tests |

Put new invariants in `test/property/` by default. Prefer one property over three examples.

## Guardrail suites

Two integration suites exist to fail when a change weakens the design. If one fails, suspect your change before the test.

- `test/integration/non-public-disclosure.test.ts` checks that withdrawn, restricted, deaccessioned, and nonexistent records never reach a client, and that not-found responses are indistinguishable.
- `test/integration/excluded-capabilities.test.ts` checks that the MCP surface is exactly what the registry declares, with no write, admin, or fetch capability.

## What to cover first

Prioritize the paths the disclosure guarantee depends on: public-record filtering, Solr escaping, canonical validation, indistinguishable not-found, cursor determinism, log redaction, and fail-closed behavior.

If you change an immutable filter or a platform's public check, add a fixture for the newly excluded case and extend `non-public-disclosure.test.ts`. Never change one enforcement layer without a test showing the others still hold.

For anything that touches the disclosure guarantee, check that your new test fails against the code without your fix. A test written alongside its implementation can share its misunderstanding.

## Fixtures

`test/fixtures/jscholarship/` and `test/fixtures/jhrdr/` hold synthetic or sanitized Solr documents, canonical API responses, and schema extracts, including deliberately non-public records for negative tests. Each directory's `README.md` records what every fixture represents, where it came from, and what was removed.

Before you add a fixture:

1. Read the directory's `README.md`.
2. Remove credentials, tokens, authentication headers, private hostnames and IP addresses, and any content that isn't already public.
3. Prefer a synthetic document with the right shape over a captured one.
4. Describe the new fixture in the `README.md`.

Never commit a payload pulled from a private endpoint without sanitizing it.
