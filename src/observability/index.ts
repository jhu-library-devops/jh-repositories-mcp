/**
 * Observability Module — Public Interface
 *
 * Exports structured logging, metrics emission, and request correlation.
 * All log output uses a deny-by-default serializer that excludes raw
 * research content, credentials, and response bodies.
 *
 * Requirements: 15.5-15.8
 */

import type { RepositoryId } from "../models/index";

// ─── Structured Log Event ────────────────────────────────────────────────────

/**
 * Approved metadata fields for the per-tool-invocation summary log.
 * Raw query text, filter values, prompts, and response bodies are excluded.
 */
export interface ToolInvocationLog {
  timestamp: string;
  requestId: string;
  client?: { name: string; version: string };
  tool: string;
  repositories: RepositoryId[];
  latencyMs: number;
  resultCount: number;
  partial: boolean;
  cache: "hit" | "miss" | "bypass";
  backendStatus: Partial<Record<RepositoryId, "ok" | "error" | "timeout">>;
  outcome: "success" | "error" | "partial";
  build: string;
}

// ─── Logger Interface ────────────────────────────────────────────────────────

/**
 * Structured logger contract.
 * Implementations must emit only approved metadata keys.
 */
export interface Logger {
  /** Emit a tool invocation summary. */
  toolInvocation(event: ToolInvocationLog): void;

  /** Log an informational message (startup, config, health). */
  info(message: string, metadata?: Record<string, unknown>): void;

  /** Log a warning (degraded behavior, missing optional features). */
  warn(message: string, metadata?: Record<string, unknown>): void;

  /** Log an error (backend failure, validation error). */
  error(message: string, metadata?: Record<string, unknown>): void;
}

// ─── Placeholder Logger ──────────────────────────────────────────────────────

/**
 * No-op logger placeholder.
 * TODO: Implement structured JSON logger with deny-by-default serializer (task 18).
 */
export const logger: Logger = {
  toolInvocation(_event) {
    // TODO: Implement structured logging (task 18.1)
  },
  info(_message, _metadata) {
    // TODO: Implement structured logging (task 18.1)
  },
  warn(_message, _metadata) {
    // TODO: Implement structured logging (task 18.1)
  },
  error(_message, _metadata) {
    // TODO: Implement structured logging (task 18.1)
  },
};

// ─── Request ID ──────────────────────────────────────────────────────────────

/**
 * Generate a unique request correlation ID.
 * TODO: Use crypto.randomUUID() in implementation (task 18.1)
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}
