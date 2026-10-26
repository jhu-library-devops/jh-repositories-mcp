/**
 * Error and warning reference. The code lists are typed against the model
 * unions, so adding or removing a code without updating this page fails
 * `bun run typecheck`. Fixed client-facing messages are read from the error
 * factories rather than copied.
 */

// External libraries
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Internal modules
import { backendUnavailable, notFound } from "../../../src/mcp/errors";
import { DocsScriptError, GENERATED_BANNER, REPO_ROOT, code, table } from "../lib";

import type { RepositoryWarning, ToolErrorCode } from "../../../src/models/index";
import type { Generated } from "./types";

type WarningCode = RepositoryWarning["code"];

// These two messages are inline in src/mcp/registry.ts rather than factories.
const UNEXPECTED_FAULT_MESSAGE = "The request could not be completed.";
const RATE_LIMITED_MESSAGE = "The server is at its concurrency limit. Retry shortly.";

interface CodeDoc {
  readonly meaning: string;
  readonly clientAction: string;
}

const TOOL_ERRORS: Readonly<Record<ToolErrorCode, CodeDoc>> = {
  invalid_input: {
    meaning:
      "The arguments failed schema validation (unknown property, out-of-range value, malformed identifier or cursor), or the requested repository is not served by this deployment.",
    clientAction: "Fix the arguments.",
  },
  unsupported_parameter: {
    meaning: "Declared in the error model but not currently emitted.",
    clientAction: "Not applicable.",
  },
  not_found: {
    meaning:
      "No public record matches the identifier. A record that exists but is not public returns exactly the same response, by design.",
    clientAction: "Treat as absent. Do not retry.",
  },
  backend_unavailable: {
    meaning:
      "Every requested repository failed, or an unexpected fault occurred. The cause is logged server-side, never returned.",
    clientAction: "Retry later. When only some repositories fail, the result is partial instead.",
  },
  deadline_exceeded: {
    meaning:
      "Declared in the error model but not currently emitted. An overrun request deadline is answered at the HTTP layer instead (see below).",
    clientAction: "Not applicable.",
  },
  rate_limited: {
    meaning: "The task is at its tool-concurrency limit.",
    clientAction: "Retry shortly.",
  },
  capability_unavailable: {
    meaning: "Declared in the error model but not currently emitted.",
    clientAction: "Not applicable.",
  },
};

const WARNINGS: Readonly<Record<WarningCode, CodeDoc>> = {
  backend_unavailable: {
    meaning: "One repository failed; results come from the others (a partial result).",
    clientAction: "Say the result is partial. Retrying later may fill it in.",
  },
  validation_attrition: {
    meaning:
      "Some candidates were dropped because the canonical API did not confirm them as public. Counts are lower bounds.",
    clientAction: "None needed. Do not treat counts as totals.",
  },
  cursor_reset: {
    meaning:
      "The cursor did not match the current query, or named a repository that is no longer selected, so pagination restarted at the first page.",
    clientAction: "Continue from the returned results and cursor.",
  },
  cursor_expanded: {
    meaning:
      "A repository joined the selection after the cursor was issued. It starts from its first page; the others continue from their offsets.",
    clientAction: "Continue from the returned results and cursor.",
  },
  deadline_exceeded: {
    meaning:
      "The federation deadline passed while some repositories were still answering. The result holds what had arrived; the slow repository is named.",
    clientAction: "Say the result is partial. Retrying later may fill it in.",
  },
  unsupported_filter: {
    meaning:
      "A filter or facet has no mapping for this repository and was not applied. The rest of the request ran.",
    clientAction: "Interpret results as unfiltered on that concept for that repository.",
  },
};

function codeTable(entries: Readonly<Record<string, CodeDoc>>): string {
  return table(
    ["Code", "Meaning", "Client action"],
    Object.entries(entries).map(([name, doc]) => [code(name), doc.meaning, doc.clientAction]),
  );
}

function renderPage(): string {
  return [
    GENERATED_BANNER,
    "",
    "# Errors and warnings",
    "",
    "Tool failures are returned as MCP tool results with `isError: true` and a single text block of the form `code: message`. Messages are fixed, client-safe text: they never contain internal URLs, hostnames, stack traces, or platform exception detail.",
    "",
    "Warnings ride along on successful results in the `warnings` array, each with a `repository`, a `code`, and a message.",
    "",
    "## Tool error codes",
    "",
    codeTable(TOOL_ERRORS),
    "",
    "## Fixed messages",
    "",
    table(
      ["Code", "Message"],
      [
        ...[notFound(), backendUnavailable()].map((failure) => [
          code(failure.toolError.code),
          failure.toolError.message,
        ]),
        [code("backend_unavailable"), `${UNEXPECTED_FAULT_MESSAGE} (unexpected faults)`],
        [code("rate_limited"), RATE_LIMITED_MESSAGE],
      ],
    ),
    "",
    "## Warning codes",
    "",
    codeTable(WARNINGS),
    "",
    "## Protocol-level errors",
    "",
    "Requests rejected before a tool runs get a JSON-RPC error, not a tool result: an unknown tool or prompt (`MethodNotFound`), an unreadable resource URI or bad prompt argument (`InvalidParams`), a disallowed `Host` or `Origin` (HTTP 403), an oversized body (HTTP 413), a request that overruns the overall deadline (HTTP 504), and `GET` or `DELETE` on `/mcp` (HTTP 405, because the transport is stateless).",
    "",
  ].join("\n");
}

/** Fail generation if the inline registry messages copied above have changed. */
function assertInlineMessagesCurrent(): void {
  const registry = readFileSync(join(REPO_ROOT, "src/mcp/registry.ts"), "utf8");
  for (const message of [UNEXPECTED_FAULT_MESSAGE, RATE_LIMITED_MESSAGE]) {
    if (!registry.includes(message)) {
      throw new DocsScriptError(
        `src/mcp/registry.ts no longer contains "${message}"; update scripts/docs/generators/errors.ts`,
      );
    }
  }
}

export function generateErrors(): Generated {
  assertInlineMessagesCurrent();
  return { files: [{ path: "docs/reference/errors.md", content: renderPage() }], regions: [] };
}
