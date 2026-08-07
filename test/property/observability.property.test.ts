/**
 * Property Tests: Privacy-Preserving Observability
 *
 * **Validates: Requirements 15.5-15.7, 16.2**
 *
 * Property 14: Logs exclude content — the deny-by-default serializer emits
 * only approved metadata keys; hostile fields smuggled onto the event object
 * and research-content values smuggled into known fields never survive.
 * EMF metric lines carry only numeric aggregates and the tool dimension.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  METRICS_NAMESPACE,
  createLogger,
  emitToolMetrics,
  serializeToolInvocation,
} from "../../src/observability/index";
import type { ToolInvocationLog } from "../../src/observability/index";

const NUM_RUNS = 150;

const APPROVED_KEYS = new Set([
  "type",
  "timestamp",
  "requestId",
  "client",
  "tool",
  "repositories",
  "latencyMs",
  "resultCount",
  "partial",
  "cache",
  "backendStatus",
  "outcome",
  "build",
]);

const RESEARCH_CONTENT = [
  "HIV status disclosure patterns in Baltimore",
  "SELECT * FROM users; --",
  "Authorization: Bearer sk-secret-token",
  "my private research question about layoffs",
];

function baseEvent(): ToolInvocationLog {
  return {
    timestamp: "2026-07-31T00:00:00.000Z",
    requestId: "req-1",
    tool: "search_items",
    repositories: ["jscholarship"],
    latencyMs: 42,
    resultCount: 3,
    partial: false,
    cache: "bypass",
    backendStatus: { jscholarship: "ok" },
    outcome: "success",
    build: "0.1.0",
  };
}

describe("Property 14: logs exclude content", () => {
  test("hostile extra fields on the event object never reach the log line", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 30 }), fc.string({ maxLength: 100 }), {
          maxKeys: 8,
        }),
        (extra) => {
          const polluted = { ...baseEvent(), ...extra, query: RESEARCH_CONTENT[0] };
          const serialized = serializeToolInvocation(polluted as ToolInvocationLog);
          for (const key of Object.keys(serialized)) {
            expect(APPROVED_KEYS.has(key)).toBe(true);
          }
          expect(JSON.stringify(serialized)).not.toContain(RESEARCH_CONTENT[0]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("research content smuggled into enum-valued fields is normalized away", () => {
    for (const content of RESEARCH_CONTENT) {
      const polluted = {
        ...baseEvent(),
        cache: content,
        outcome: content,
        repositories: [content, "jscholarship"],
        backendStatus: { [content]: "ok", jscholarship: content },
      } as unknown as ToolInvocationLog;
      const line = JSON.stringify(serializeToolInvocation(polluted));
      expect(line).not.toContain(content);
    }
  });

  test("free-text log messages are bounded and metadata objects are never emitted", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    log.info("startup complete", { secret: RESEARCH_CONTENT[2] });
    log.error("x".repeat(2000));
    expect(lines[0]).not.toContain("Bearer");
    const parsed = JSON.parse(lines[1] ?? "{}") as { message: string };
    expect(parsed.message.length).toBeLessThanOrEqual(500);
  });

  test("EMF lines carry only numeric aggregates and the tool dimension", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (hostile) => {
        const lines: string[] = [];
        const event = {
          ...baseEvent(),
          tool: "get_item",
          query: hostile,
        } as ToolInvocationLog & { query: string };
        emitToolMetrics(event, (line) => lines.push(line));
        const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
        expect(
          (parsed._aws as { CloudWatchMetrics: [{ Namespace: string }] }).CloudWatchMetrics[0]
            .Namespace,
        ).toBe(METRICS_NAMESPACE);
        expect(parsed.Tool).toBe("get_item");
        expect(parsed.Calls).toBe(1);
        expect(lines[0]).not.toContain("query");
      }),
      { numRuns: 50 },
    );
  });
});
