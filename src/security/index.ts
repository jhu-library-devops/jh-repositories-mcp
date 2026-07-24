/**
 * Security Module — Public Interface
 *
 * Exports middleware and validation for Host/Origin allowlisting,
 * request bounds, and application-level concurrency controls.
 *
 * Requirements: 14.2-14.6
 */

// ─── Host Validation ─────────────────────────────────────────────────────────

/**
 * Configuration for Host header validation.
 */
export interface HostValidationConfig {
  /** Allowed Host header values (exact match). */
  allowedHosts: readonly string[];
}

/**
 * Validate the Host header against the configured allowlist.
 * Returns true if the host is allowed.
 *
 * TODO: Implement as Hono middleware (task 16.4)
 */
export function isHostAllowed(host: string, config: HostValidationConfig): boolean {
  return config.allowedHosts.includes(host);
}

// ─── Origin Validation ───────────────────────────────────────────────────────

/**
 * Configuration for Origin header validation.
 */
export interface OriginValidationConfig {
  /** Allowed Origin values. Missing Origin is valid for non-browser MCP clients. */
  allowedOrigins: readonly string[];
}

/**
 * Validate the Origin header when present.
 * Missing Origin is valid (non-browser MCP clients).
 * Returns true if the origin is allowed or absent.
 *
 * TODO: Implement as Hono middleware (task 16.4)
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  config: OriginValidationConfig,
): boolean {
  if (origin == null || origin === "") return true;
  return config.allowedOrigins.includes(origin);
}

// ─── Request Bounds ──────────────────────────────────────────────────────────

/**
 * Configuration for request size and timing bounds.
 */
export interface RequestBoundsConfig {
  /** Maximum request body size in bytes. */
  maxBodyBytes: number;

  /** Overall request deadline in milliseconds. */
  deadlineMs: number;

  /** Maximum concurrent tool invocations per task. */
  maxConcurrency: number;
}

/**
 * Default request bounds for the MCP server.
 */
export const defaultRequestBounds: RequestBoundsConfig = {
  maxBodyBytes: 64 * 1024, // 64 KiB
  deadlineMs: 10_000, // 10 seconds
  maxConcurrency: 10,
};
