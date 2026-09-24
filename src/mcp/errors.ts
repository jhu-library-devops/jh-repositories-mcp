/**
 * Tool Error Types
 *
 * Typed failures thrown by tool handlers and mapped to MCP tool errors at the
 * registry boundary. Messages are fixed, client-safe text: no internal URLs,
 * endpoints, stack traces, or platform exception detail ever appears here.
 *
 * Requirements: 5.4-5.5, 9.5, 12.5, 15.3
 */

import type { RepositoryId, ToolError } from "../models/index";

export class ToolFailure extends Error {
  constructor(readonly toolError: ToolError) {
    super(toolError.message);
    this.name = "ToolFailure";
  }
}

export function invalidInput(message: string): ToolFailure {
  return new ToolFailure({ code: "invalid_input", message });
}

const REPOSITORY_NAMES: Readonly<Record<RepositoryId, string>> = {
  jscholarship: "JScholarship",
  jhrdr: "JHRDR",
};

/**
 * A repository this deployment does not serve (its adapter is not
 * configured). Names what is available so the reader can tell a
 * deployment's scope from an outage.
 */
export function repositoryNotAvailable(
  requested: RepositoryId | "all",
  available: readonly RepositoryId[],
): ToolFailure {
  const name = requested === "all" ? "No repository" : REPOSITORY_NAMES[requested];
  const offered =
    available.length > 0
      ? ` Available here: ${available.map((id) => REPOSITORY_NAMES[id]).join(", ")}.`
      : "";
  return invalidInput(`${name} is not available on this server.${offered}`);
}

/**
 * The single not-found shape: nonexistent and non-public identifiers are
 * indistinguishable by design (Requirement 9.5).
 */
export function notFound(): ToolFailure {
  return new ToolFailure({
    code: "not_found",
    message: "No public record matches this identifier.",
  });
}

export function backendUnavailable(): ToolFailure {
  return new ToolFailure({
    code: "backend_unavailable",
    message: "The repository backend is temporarily unavailable. Try again shortly.",
  });
}
