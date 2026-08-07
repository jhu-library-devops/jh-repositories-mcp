/**
 * Tool Error Types
 *
 * Typed failures thrown by tool handlers and mapped to MCP tool errors at the
 * registry boundary. Messages are fixed, client-safe text: no internal URLs,
 * endpoints, stack traces, or platform exception detail ever appears here.
 *
 * Requirements: 5.4-5.5, 9.5, 12.5, 15.3
 */

import type { ToolError } from "../models/index";

export class ToolFailure extends Error {
  constructor(readonly toolError: ToolError) {
    super(toolError.message);
    this.name = "ToolFailure";
  }
}

export function invalidInput(message: string): ToolFailure {
  return new ToolFailure({ code: "invalid_input", message });
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
