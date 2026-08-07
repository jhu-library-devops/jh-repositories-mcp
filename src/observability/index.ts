/**
 * Observability Module — Structured Logging and CloudWatch EMF Metrics
 *
 * One structured summary event per tool invocation, emitted through a
 * DENY-BY-DEFAULT serializer: only approved metadata keys can ever reach a
 * log line, so raw search text, filter values, prompts, conversation
 * content, record abstracts, identities, tokens, and response bodies are
 * excluded by construction rather than by discipline. Metrics are emitted as
 * CloudWatch Embedded Metric Format lines on stdout.
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

// ─── Deny-by-default serializer (task 18.2) ─────────────────────────────────

const REPOSITORY_IDS = new Set(["jscholarship", "jhrdr"]);
const CACHE_VALUES = new Set(["hit", "miss", "bypass"]);
const OUTCOME_VALUES = new Set(["success", "error", "partial"]);
const BACKEND_VALUES = new Set(["ok", "error", "timeout"]);

const MAX_NAME_LENGTH = 100;

function boundedName(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_NAME_LENGTH) : "unknown";
}

/**
 * Serialize a tool-invocation event to its approved shape. Every emitted key
 * is explicitly constructed here; unknown fields on the input object — or
 * hostile values smuggled into known fields — cannot survive serialization.
 */
export function serializeToolInvocation(event: ToolInvocationLog): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    type: "tool_invocation",
    timestamp: boundedName(event.timestamp),
    requestId: boundedName(event.requestId),
    tool: boundedName(event.tool),
    repositories: (Array.isArray(event.repositories) ? event.repositories : []).filter(
      (repo): repo is RepositoryId => REPOSITORY_IDS.has(repo),
    ),
    latencyMs: Number.isFinite(event.latencyMs) ? Math.max(0, Math.round(event.latencyMs)) : 0,
    resultCount: Number.isFinite(event.resultCount)
      ? Math.max(0, Math.round(event.resultCount))
      : 0,
    partial: event.partial === true,
    cache: CACHE_VALUES.has(event.cache) ? event.cache : "bypass",
    backendStatus: Object.fromEntries(
      Object.entries(event.backendStatus ?? {}).filter(
        ([repo, status]) => REPOSITORY_IDS.has(repo) && BACKEND_VALUES.has(String(status)),
      ),
    ),
    outcome: OUTCOME_VALUES.has(event.outcome) ? event.outcome : "error",
    build: boundedName(event.build),
  };
  if (event.client !== undefined) {
    serialized.client = {
      name: boundedName(event.client.name),
      version: boundedName(event.client.version),
    };
  }
  return serialized;
}

// ─── Logger (task 18.1) ─────────────────────────────────────────────────────

export type LogWriter = (line: string) => void;

export interface Logger {
  toolInvocation(event: ToolInvocationLog): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

/** Free-text messages are bounded; caller metadata objects are NOT emitted. */
function messageLine(level: string, message: string): string {
  return JSON.stringify({
    type: "log",
    level,
    timestamp: new Date().toISOString(),
    message: message.slice(0, 500),
  });
}

export function createLogger(writer: LogWriter = console.log): Logger {
  return {
    toolInvocation(event) {
      writer(JSON.stringify(serializeToolInvocation(event)));
    },
    info(message) {
      writer(messageLine("info", message));
    },
    warn(message) {
      writer(messageLine("warn", message));
    },
    error(message) {
      writer(messageLine("error", message));
    },
  };
}

export const logger: Logger = createLogger();

// ─── CloudWatch Embedded Metric Format (task 18.3) ──────────────────────────

export const METRICS_NAMESPACE = "JhuRepositoryMcp";

/**
 * Emit one EMF line per tool invocation: calls, errors, latency, zero
 * results, and partial results — dimensioned by tool.
 */
export function emitToolMetrics(event: ToolInvocationLog, writer: LogWriter = console.log): void {
  const serialized = serializeToolInvocation(event);
  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [["Tool"]],
          Metrics: [
            { Name: "Calls", Unit: "Count" },
            { Name: "Errors", Unit: "Count" },
            { Name: "LatencyMs", Unit: "Milliseconds" },
            { Name: "ZeroResults", Unit: "Count" },
            { Name: "PartialResults", Unit: "Count" },
          ],
        },
      ],
    },
    Tool: serialized.tool,
    Calls: 1,
    Errors: serialized.outcome === "error" ? 1 : 0,
    LatencyMs: serialized.latencyMs,
    ZeroResults: serialized.resultCount === 0 && serialized.outcome === "success" ? 1 : 0,
    PartialResults: serialized.partial === true ? 1 : 0,
  };
  writer(JSON.stringify(emf));
}

// ─── Request ID ──────────────────────────────────────────────────────────────

export function generateRequestId(): string {
  return crypto.randomUUID();
}
