/**
 * Unit Tests: Per-Repository (Federated) Observability
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6**
 *
 * Covers the generalization of telemetry from the fixed two-repository shape to
 * a per-repository collection: the deny-by-default federated serializer, the
 * per-repository CloudWatch metric emitter dimensioned by repository id,
 * automatic inclusion of newly registered adapters, and non-fatal metric
 * emission failure.
 */

import { describe, expect, test } from "bun:test";
import {
  METRICS_NAMESPACE,
  createLogger,
  emitRepositoryMetrics,
  registerRepositoryId,
  serializeFederatedInvocation,
} from "../../src/observability/index";
import type { FederatedInvocationLog } from "../../src/observability/index";

function baseEvent(): FederatedInvocationLog {
  return {
    timestamp: "2026-07-31T00:00:00.000Z",
    requestId: "req-1",
    tool: "search_items",
    totalAdapters: 2,
    respondingAdapters: 2,
    perRepository: [
      {
        repository: "jscholarship",
        latencyMs: 42,
        resultCount: 3,
        validationOmissions: 0,
        outcome: "success",
      },
      {
        repository: "jhrdr",
        latencyMs: 88,
        resultCount: 1,
        validationOmissions: 2,
        outcome: "partial",
      },
    ],
    outcome: "partial",
  };
}

const APPROVED_KEYS = new Set([
  "type",
  "timestamp",
  "requestId",
  "tool",
  "totalAdapters",
  "respondingAdapters",
  "perRepository",
  "outcome",
]);

const APPROVED_ENTRY_KEYS = new Set([
  "repository",
  "latencyMs",
  "resultCount",
  "validationOmissions",
  "outcome",
]);

describe("serializeFederatedInvocation (Req 11.1, 11.3, 11.4)", () => {
  test("emits per-repository latency, result count, omissions, and outcome", () => {
    const serialized = serializeFederatedInvocation(baseEvent());
    expect(serialized.type).toBe("federated_invocation");
    expect(serialized.totalAdapters).toBe(2);
    expect(serialized.respondingAdapters).toBe(2);
    const entries = serialized.perRepository as Array<Record<string, unknown>>;
    expect(entries).toEqual([
      {
        repository: "jscholarship",
        latencyMs: 42,
        resultCount: 3,
        validationOmissions: 0,
        outcome: "success",
      },
      {
        repository: "jhrdr",
        latencyMs: 88,
        resultCount: 1,
        validationOmissions: 2,
        outcome: "partial",
      },
    ]);
  });

  test("reports total and responding adapter counts independently (Req 11.3)", () => {
    const event: FederatedInvocationLog = {
      ...baseEvent(),
      totalAdapters: 3,
      respondingAdapters: 2,
    };
    const serialized = serializeFederatedInvocation(event);
    expect(serialized.totalAdapters).toBe(3);
    expect(serialized.respondingAdapters).toBe(2);
  });

  test("only approved keys reach the log line, top-level and per-entry", () => {
    const polluted = {
      ...baseEvent(),
      query: "HIV status disclosure patterns",
      perRepository: [
        {
          repository: "jscholarship",
          latencyMs: 10,
          resultCount: 1,
          validationOmissions: 0,
          outcome: "success",
          rawQuery: "secret filter value",
        },
      ],
    } as unknown as FederatedInvocationLog;
    const serialized = serializeFederatedInvocation(polluted);
    for (const key of Object.keys(serialized)) {
      expect(APPROVED_KEYS.has(key)).toBe(true);
    }
    const entries = serialized.perRepository as Array<Record<string, unknown>>;
    for (const key of Object.keys(entries[0] ?? {})) {
      expect(APPROVED_ENTRY_KEYS.has(key)).toBe(true);
    }
    expect(JSON.stringify(serialized)).not.toContain("HIV status");
    expect(JSON.stringify(serialized)).not.toContain("secret filter value");
  });

  test("hostile values smuggled into numeric and enum fields are normalized", () => {
    const content = "SELECT * FROM users; --";
    const polluted = {
      ...baseEvent(),
      totalAdapters: content,
      perRepository: [
        {
          repository: content,
          latencyMs: content,
          resultCount: -5,
          validationOmissions: content,
          outcome: content,
        },
      ],
    } as unknown as FederatedInvocationLog;
    const line = JSON.stringify(serializeFederatedInvocation(polluted));
    expect(line).not.toContain(content);
    const entries = serializeFederatedInvocation(polluted).perRepository as Array<
      Record<string, unknown>
    >;
    expect(entries[0]).toEqual({
      repository: "unknown",
      latencyMs: 0,
      resultCount: 0,
      validationOmissions: 0,
      outcome: "error",
    });
  });
});

describe("emitRepositoryMetrics (Req 11.2, 11.5, 11.6)", () => {
  test("emits one EMF line per responding adapter dimensioned by repository id", () => {
    const lines: string[] = [];
    emitRepositoryMetrics(baseEvent(), (line) => lines.push(line));
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const metrics = (
      first._aws as { CloudWatchMetrics: [{ Namespace: string; Dimensions: string[][] }] }
    ).CloudWatchMetrics[0];
    expect(metrics.Namespace).toBe(METRICS_NAMESPACE);
    expect(metrics.Dimensions).toEqual([["Repository"]]);
    expect(first.Repository).toBe("jscholarship");
    expect(first.Invocations).toBe(1);
    expect(first.LatencyMs).toBe(42);
    expect(first.Available).toBe(1);

    const second = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    expect(second.Repository).toBe("jhrdr");
    expect(second.ValidationOmissions).toBe(2);
  });

  test("declares the full per-repository metric set in the EMF definition (Req 11.2)", () => {
    const lines: string[] = [];
    emitRepositoryMetrics(baseEvent(), (line) => lines.push(line));
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const definition = (
      parsed._aws as { CloudWatchMetrics: [{ Metrics: Array<{ Name: string }> }] }
    ).CloudWatchMetrics[0];
    const metricNames = definition.Metrics.map((metric) => metric.Name);
    expect(metricNames).toEqual([
      "Invocations",
      "LatencyMs",
      "Errors",
      "ValidationOmissions",
      "Available",
    ]);
  });

  test("an error outcome records an error and marks the adapter unavailable", () => {
    const lines: string[] = [];
    const event: FederatedInvocationLog = {
      ...baseEvent(),
      perRepository: [
        {
          repository: "jscholarship",
          latencyMs: 12,
          resultCount: 0,
          validationOmissions: 0,
          outcome: "error",
        },
      ],
    };
    emitRepositoryMetrics(event, (line) => lines.push(line));
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed.Errors).toBe(1);
    expect(parsed.Available).toBe(0);
  });

  test("a newly registered adapter id is included automatically (Req 11.5)", () => {
    registerRepositoryId("newrepo");
    const event: FederatedInvocationLog = {
      ...baseEvent(),
      perRepository: [
        {
          repository: "newrepo" as FederatedInvocationLog["perRepository"][number]["repository"],
          latencyMs: 7,
          resultCount: 4,
          validationOmissions: 0,
          outcome: "success",
        },
      ],
    };
    const serialized = serializeFederatedInvocation(event);
    const entries = serialized.perRepository as Array<Record<string, unknown>>;
    expect(entries[0]?.repository).toBe("newrepo");

    const lines: string[] = [];
    emitRepositoryMetrics(event, (line) => lines.push(line));
    expect(JSON.parse(lines[0] ?? "{}").Repository).toBe("newrepo");
  });

  test("metric emission failure is non-fatal and continues processing (Req 11.6)", () => {
    let calls = 0;
    expect(() =>
      emitRepositoryMetrics(baseEvent(), () => {
        calls += 1;
        throw new Error("broken pipe");
      }),
    ).not.toThrow();
    // Both adapters are still attempted despite the first write throwing.
    expect(calls).toBe(2);
  });

  test("the logger emits the federated serialized shape", () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line)).federatedInvocation(baseEvent());
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed.type).toBe("federated_invocation");
    expect((parsed.perRepository as unknown[]).length).toBe(2);
  });
});
