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
 * Returns true if the host is allowed. Applied per request by `edgeMiddleware`.
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
 * Returns true if the origin is allowed or absent. Applied per request by
 * `edgeMiddleware`.
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

// ─── Hono Middleware (task 16.4) ─────────────────────────────────────────────

import type { MiddlewareHandler } from "hono";

export interface EdgeMiddlewareConfig {
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
  maxBodyBytes: number;
}

/**
 * Edge middleware for the MCP route: request correlation ID, exact Host
 * allowlisting, Origin allowlisting when Origin is present (missing Origin
 * stays valid for non-browser MCP clients), and a request-size bound via
 * Content-Length. Rejections are structured JSON-RPC-shaped errors with no
 * internal detail.
 *
 * Requirements: 14.2-14.5, 15.1
 */
export function edgeMiddleware(config: EdgeMiddlewareConfig): MiddlewareHandler {
  return async (c, next) => {
    const requestId = crypto.randomUUID();
    c.header("x-request-id", requestId);
    c.set("requestId" as never, requestId as never);

    const host = c.req.header("host") ?? "";
    if (
      config.allowedHosts.length > 0 &&
      !isHostAllowed(host, { allowedHosts: config.allowedHosts })
    ) {
      return c.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Forbidden host" }, id: null },
        403,
      );
    }

    const origin = c.req.header("origin");
    if (!isOriginAllowed(origin, { allowedOrigins: config.allowedOrigins })) {
      return c.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Forbidden origin" }, id: null },
        403,
      );
    }

    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > config.maxBodyBytes) {
      return c.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Request too large" }, id: null },
        413,
      );
    }

    await next();
  };
}

/**
 * Overall request deadline: responds 504 with a structured error if the
 * downstream handler exceeds deadlineMs (Requirement 15.1).
 */
export function deadlineMiddleware(deadlineMs: number): MiddlewareHandler {
  return async (c, next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), deadlineMs);
    });
    const outcome = await Promise.race([next().then(() => "done" as const), timeout]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (outcome === "timeout") {
      return c.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Request deadline exceeded" }, id: null },
        504,
      );
    }
    return;
  };
}

// ─── Tool Concurrency Semaphore (task 17.3) ──────────────────────────────────

export interface Semaphore {
  /** Acquire a slot if one is free; returns false (never queues) otherwise. */
  tryAcquire(): boolean;
  release(): void;
  readonly active: number;
}

/**
 * Non-queuing counting semaphore: callers that cannot acquire a slot are
 * rejected immediately with a rate-limited error rather than building an
 * unbounded backlog (Requirements 14.6, 15.4).
 */
export function createSemaphore(max: number): Semaphore {
  let active = 0;
  return {
    tryAcquire(): boolean {
      if (active >= max) {
        return false;
      }
      active += 1;
      return true;
    },
    release(): void {
      active = Math.max(0, active - 1);
    },
    get active(): number {
      return active;
    },
  };
}
