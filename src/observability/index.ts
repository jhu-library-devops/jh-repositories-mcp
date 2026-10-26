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
 * Telemetry generalizes from the fixed two-repository shape to a per-repository
 * collection ({@link RepositoryTelemetry} / {@link FederatedInvocationLog}),
 * dimensioned by repository id so newly registered adapters are included
 * automatically. The generalization is additive: the legacy
 * {@link ToolInvocationLog} path is preserved for existing consumers.
 *
 * Requirements: 11.1-11.6, 15.5-15.8
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

// ─── Per-repository telemetry (task 13.1) ────────────────────────────────────

/**
 * Per-adapter telemetry for one tool invocation. Carries only closed-shape
 * numeric and token fields — never query text, filter values, or response
 * content (Req 11.4). One of these is produced per responding adapter and
 * collected into {@link FederatedInvocationLog.perRepository}.
 *
 * Requirements: 11.1
 */
export interface RepositoryTelemetry {
  readonly repository: RepositoryId;
  readonly latencyMs: number;
  readonly resultCount: number;
  readonly validationOmissions: number;
  readonly outcome: "success" | "partial" | "error";
}

/**
 * Per-invocation log generalized from the fixed two-repository shape to a
 * per-repository collection. Emitted alongside — not in place of — the legacy
 * {@link ToolInvocationLog}, so existing consumers remain unaffected.
 *
 * Requirements: 11.1, 11.3
 */
export interface FederatedInvocationLog {
  readonly timestamp: string;
  readonly requestId: string;
  readonly tool: string;
  readonly totalAdapters: number;
  readonly respondingAdapters: number;
  readonly perRepository: readonly RepositoryTelemetry[];
  readonly outcome: "success" | "partial" | "error";
}

// ─── Deny-by-default serializer (task 18.2) ─────────────────────────────────

/**
 * Pattern for an acceptable repository id token when no explicit allowlist is
 * registered. Lowercase, digits, hyphen, underscore — the lowercase-id
 * convention from `AGENTS.md`. This is what lets a newly registered adapter's
 * id flow into logs and metric dimensions automatically (Req 11.5) without a
 * code change, while still denying arbitrary strings by construction.
 */
const REPOSITORY_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

/**
 * Known repository ids. Seeded with the two v1 repositories; adapters register
 * their ids here at startup so the deny-by-default serializer recognizes them
 * without a hardcoded set. Falls back to {@link REPOSITORY_ID_PATTERN} for ids
 * registered after a log line is constructed, so registration order never
 * silently drops a legitimate adapter.
 */
const REPOSITORY_IDS = new Set<string>(["jscholarship", "jhrdr"]);

/**
 * Register a repository id so the serializer admits it as a known value and
 * includes it in per-repository metric dimensions. Idempotent and additive;
 * derives the dimension value from the adapter id with no manual metric
 * configuration (Req 11.5). Non-conforming ids are ignored.
 */
export function registerRepositoryId(id: string): void {
  if (typeof id === "string" && REPOSITORY_ID_PATTERN.test(id)) {
    REPOSITORY_IDS.add(id);
  }
}

/** True when `id` is a registered repository id or matches the id pattern. */
function isKnownRepositoryId(id: unknown): id is RepositoryId {
  return typeof id === "string" && (REPOSITORY_IDS.has(id) || REPOSITORY_ID_PATTERN.test(id));
}

const CACHE_VALUES = new Set(["hit", "miss", "bypass"]);
const OUTCOME_VALUES = new Set(["success", "error", "partial"]);
const BACKEND_VALUES = new Set(["ok", "error", "timeout"]);

const MAX_NAME_LENGTH = 100;

function boundedName(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_NAME_LENGTH) : "unknown";
}

function boundedCount(value: unknown): number {
  return Number.isFinite(value as number) ? Math.max(0, Math.round(value as number)) : 0;
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
      (repo): repo is RepositoryId => isKnownRepositoryId(repo),
    ),
    latencyMs: Number.isFinite(event.latencyMs) ? Math.max(0, Math.round(event.latencyMs)) : 0,
    resultCount: Number.isFinite(event.resultCount)
      ? Math.max(0, Math.round(event.resultCount))
      : 0,
    partial: event.partial === true,
    cache: CACHE_VALUES.has(event.cache) ? event.cache : "bypass",
    backendStatus: Object.fromEntries(
      Object.entries(event.backendStatus ?? {}).filter(
        ([repo, status]) => isKnownRepositoryId(repo) && BACKEND_VALUES.has(String(status)),
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

/**
 * Serialize one per-repository telemetry record to its approved shape. The
 * repository id is validated against the registered set / id pattern; every
 * other field is a bounded non-negative integer or a closed-shape outcome
 * token. No query text, filter values, or response content can appear.
 *
 * Requirements: 11.1, 11.4
 */
function serializeRepositoryTelemetry(entry: RepositoryTelemetry): Record<string, unknown> {
  return {
    repository: isKnownRepositoryId(entry.repository) ? entry.repository : "unknown",
    latencyMs: boundedCount(entry.latencyMs),
    resultCount: boundedCount(entry.resultCount),
    validationOmissions: boundedCount(entry.validationOmissions),
    outcome: OUTCOME_VALUES.has(entry.outcome) ? entry.outcome : "error",
  };
}

/**
 * Serialize a federated (per-repository) invocation event to its approved
 * shape. Like {@link serializeToolInvocation}, every emitted key is explicitly
 * constructed here, so unknown fields or hostile values cannot survive
 * serialization regardless of the number of repositories (Req 11.4).
 *
 * Requirements: 11.1, 11.3, 11.4
 */
export function serializeFederatedInvocation(
  event: FederatedInvocationLog,
): Record<string, unknown> {
  const perRepository = (Array.isArray(event.perRepository) ? event.perRepository : []).map(
    serializeRepositoryTelemetry,
  );
  return {
    type: "federated_invocation",
    timestamp: boundedName(event.timestamp),
    requestId: boundedName(event.requestId),
    tool: boundedName(event.tool),
    totalAdapters: boundedCount(event.totalAdapters),
    respondingAdapters: boundedCount(event.respondingAdapters),
    perRepository,
    outcome: OUTCOME_VALUES.has(event.outcome) ? event.outcome : "error",
  };
}

// ─── Backend fault event ─────────────────────────────────────────────────────

/**
 * Why a canonical lookup surfaced as `backend_unavailable`. The client sees
 * only the opaque error (Requirement 5.5); this line gives operators the
 * failing call and HTTP status. No URL, identifier, or error message is
 * carried — only closed-shape tokens.
 */
export interface BackendFaultLog {
  timestamp: string;
  tool: string;
  repository: RepositoryId;
  /** Adapter-reported call name, e.g. `item`, `bundles`, `handle_lookup`. */
  operation: string;
  errorName: string;
  status: number | null;
  /**
   * What the client got: the opaque error, the record without its files, or
   * results from the other repositories only.
   */
  effect: "backend_unavailable" | "files_omitted" | "partial_results";
}

const TOKEN_PATTERN = /^[a-z_]{1,40}$/;
const ERROR_NAME_PATTERN = /^[A-Za-z]{1,60}$/;

export function serializeBackendFault(event: BackendFaultLog): Record<string, unknown> {
  return {
    type: "backend_fault",
    timestamp: boundedName(event.timestamp),
    tool: boundedName(event.tool),
    repository: isKnownRepositoryId(event.repository) ? event.repository : "unknown",
    operation:
      typeof event.operation === "string" && TOKEN_PATTERN.test(event.operation)
        ? event.operation
        : "unknown",
    errorName:
      typeof event.errorName === "string" && ERROR_NAME_PATTERN.test(event.errorName)
        ? event.errorName
        : "Error",
    effect:
      event.effect === "files_omitted" || event.effect === "partial_results"
        ? event.effect
        : "backend_unavailable",
    status:
      Number.isInteger(event.status) &&
      (event.status as number) >= 100 &&
      (event.status as number) <= 599
        ? event.status
        : null,
  };
}

// ─── Logger (task 18.1) ─────────────────────────────────────────────────────

export type LogWriter = (line: string) => void;

export interface Logger {
  toolInvocation(event: ToolInvocationLog): void;
  federatedInvocation(event: FederatedInvocationLog): void;
  backendFault(event: BackendFaultLog): void;
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
    federatedInvocation(event) {
      writer(JSON.stringify(serializeFederatedInvocation(event)));
    },
    backendFault(event) {
      writer(JSON.stringify(serializeBackendFault(event)));
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
  safeEmit(emf, writer);
}

/**
 * Write a metric line, keeping emission failure non-fatal: a writer that
 * throws (e.g. a broken stdout pipe) is caught, logged locally, and swallowed
 * so tool processing continues and no error reaches the client (Req 11.6).
 */
function safeEmit(emf: Record<string, unknown>, writer: LogWriter): void {
  try {
    writer(JSON.stringify(emf));
  } catch (error) {
    logger.warn(`metric_emission_failed: ${error instanceof Error ? error.name : "UnknownError"}`);
  }
}

/**
 * Emit one EMF line per responding adapter, dimensioned by repository id so a
 * newly registered adapter is included automatically with no manual metric
 * configuration (Req 11.5). Publishes invocation count, latency (for p50/p95/
 * p99 aggregation), errors, validation omissions, and availability. Emission
 * failure is non-fatal (Req 11.6).
 *
 * Requirements: 11.2, 11.5, 11.6
 */
export function emitRepositoryMetrics(
  event: FederatedInvocationLog,
  writer: LogWriter = console.log,
): void {
  const serialized = serializeFederatedInvocation(event);
  const perRepository = serialized.perRepository as Array<Record<string, unknown>>;
  const timestamp = Date.now();
  for (const entry of perRepository) {
    const outcome = entry.outcome as RepositoryTelemetry["outcome"];
    const emf = {
      _aws: {
        Timestamp: timestamp,
        CloudWatchMetrics: [
          {
            Namespace: METRICS_NAMESPACE,
            Dimensions: [["Repository"]],
            Metrics: [
              { Name: "Invocations", Unit: "Count" },
              { Name: "LatencyMs", Unit: "Milliseconds" },
              { Name: "Errors", Unit: "Count" },
              { Name: "ValidationOmissions", Unit: "Count" },
              { Name: "Available", Unit: "Count" },
            ],
          },
        ],
      },
      Repository: entry.repository,
      Invocations: 1,
      LatencyMs: entry.latencyMs,
      Errors: outcome === "error" ? 1 : 0,
      ValidationOmissions: entry.validationOmissions,
      Available: outcome === "error" ? 0 : 1,
    };
    safeEmit(emf, writer);
  }
}

// ─── Dispatch fan-out metric (task 10.3) ────────────────────────────────────

/**
 * One request's dispatch fan-out: how many adapters were actually called,
 * against the configured maximum. The alarm threshold (`≥ 75%` of
 * `maxAdapters`) is evaluated in CloudWatch, not here — this emitter only
 * publishes the raw fan-out so that threshold can move without a code change
 * (Req 10.7).
 */
export interface FanOutEvent {
  /** Number of adapters dispatched for this request. */
  readonly adaptersCalled: number;
  /** Configured maximum adapter count (FederationLimits.maxAdapters). */
  readonly maxAdapters: number;
}

/**
 * Emit one EMF line recording dispatch fan-out for a single request (Req 10.7).
 *
 * Publishes `DispatchFanOut` (adapters called this request) under the service
 * namespace, dimensioned by `Service` so the metric is a single per-service
 * series the fan-out alarm watches. `MaxAdapters` is emitted as a companion
 * metric so the configured ceiling is visible in dashboards alongside the
 * observed fan-out. Both counts are bounded to non-negative integers and the
 * fan-out is capped at the configured maximum, since a request can never
 * dispatch more adapters than are registered. Emission failure is non-fatal
 * (Req 11.6).
 */
export function emitFanOutMetric(
  event: FanOutEvent,
  serviceName = "federation",
  writer: LogWriter = console.log,
): void {
  const maxAdapters = boundedCount(event.maxAdapters);
  const adaptersCalled = Math.min(
    boundedCount(event.adaptersCalled),
    maxAdapters || Number.POSITIVE_INFINITY,
  );
  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [["Service"]],
          Metrics: [
            { Name: "DispatchFanOut", Unit: "Count" },
            { Name: "MaxAdapters", Unit: "Count" },
          ],
        },
      ],
    },
    Service: boundedName(serviceName),
    DispatchFanOut: adaptersCalled,
    MaxAdapters: maxAdapters,
  };
  safeEmit(emf, writer);
}

// ─── Request ID ──────────────────────────────────────────────────────────────

export function generateRequestId(): string {
  return crypto.randomUUID();
}
