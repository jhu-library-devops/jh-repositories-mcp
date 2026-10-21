/**
 * Unit Tests: Limit Boundaries, Deadline Behavior, and Fan-Out Metric
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.5, 10.6, 10.7**
 *
 * Three concerns of the configuration/limits layer, each verified against its
 * pure-ish unit:
 *
 * - `allocateFetchWindows` (src/federation/window-allocation.ts) — the exact
 *   canonicalization-budget boundary. When the summed over-fetch ceilings equal
 *   the budget, every repository gets its full ceiling; one candidate over the
 *   budget flips allocation to proportional reduction summing to the budget
 *   (Req 10.3, 10.4, with weight/count bounds from 10.1, 10.2).
 * - `runUnderDeadline` + `clampDeadlineMs` (src/federation/deadline.ts) — the
 *   completed/partial/deadline_exceeded outcomes and the 1000–10000 ms clamp
 *   (Req 10.5, 10.6).
 * - `emitFanOutMetric` (src/observability/index.ts) — the EMF line shape
 *   (DispatchFanOut/MaxAdapters dimensioned by Service) and the cap at
 *   maxAdapters (Req 10.7). The ≥75% alarm threshold itself is evaluated in
 *   CloudWatch — `ceil(max * 0.75)` in infra/modules/mcp-service/observability.tf
 *   — so this suite asserts the metric emission the alarm reads rather than the
 *   alarm.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DEADLINE_MS,
  MAX_DEADLINE_MS,
  MIN_DEADLINE_MS,
  clampDeadlineMs,
  runUnderDeadline,
} from "../../src/federation/deadline";
import {
  type FusionWeight,
  OVER_FETCH_MULTIPLE,
  allocateFetchWindows,
} from "../../src/federation/window-allocation";
import type { RepositoryId } from "../../src/models/index";
import type { FanOutEvent } from "../../src/observability/index";
import { METRICS_NAMESPACE, emitFanOutMetric } from "../../src/observability/index";

/**
 * Cast a synthetic repository id to `RepositoryId` for weight/allocation tests.
 * `allocateFetchWindows` is generic over the id string and treats ids opaquely,
 * so exercising a 3-way weighted split needs ids beyond the two currently in
 * the closed `RepositoryId` union without weakening the function's own typing.
 */
function repo(id: string): RepositoryId {
  return id as RepositoryId;
}

// ─── allocateFetchWindows: the exact budget boundary (Req 10.3, 10.4) ────────

describe("allocateFetchWindows budget boundary (Req 10.3, 10.4)", () => {
  const equalWeights = (ids: readonly RepositoryId[]): ReadonlyMap<RepositoryId, FusionWeight> =>
    new Map(ids.map((id) => [id, 1.0] as const));

  test("total ceiling exactly equal to budget yields full ceilings for every repository", () => {
    // 2 repositories × (3 × 25) = 150 ceilings total == budget 150.
    const selected: readonly RepositoryId[] = ["jhrdr", "jscholarship"];
    const limit = 25;
    const ceiling = OVER_FETCH_MULTIPLE * limit; // 75

    const windows = allocateFetchWindows({
      selected,
      limit,
      weights: equalWeights(selected),
      budget: 150,
    });

    expect(windows.get("jscholarship")).toBe(ceiling);
    expect(windows.get("jhrdr")).toBe(ceiling);
    const total = [...windows.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(150);
  });

  test("total ceiling one over the budget flips to proportional allocation summing to budget", () => {
    // Same two repositories, budget reduced by one to 149 so the 150 ceilings
    // no longer fit: allocation must become proportional and sum to 149.
    const selected: readonly RepositoryId[] = ["jhrdr", "jscholarship"];
    const limit = 25;
    const ceiling = OVER_FETCH_MULTIPLE * limit; // 75

    const windows = allocateFetchWindows({
      selected,
      limit,
      weights: equalWeights(selected),
      budget: 149,
    });

    const total = [...windows.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(149);
    // Equal weights across two repositories: 149 splits 75 / 74 (largest
    // remainder awards the odd candidate to the lexicographically smaller id).
    expect(windows.get("jhrdr")).toBe(75);
    expect(windows.get("jscholarship")).toBe(74);
    // No window exceeds its own ceiling.
    for (const value of windows.values()) {
      expect(value).toBeLessThanOrEqual(ceiling);
    }
  });

  test("proportional reduction follows configured weights when over budget", () => {
    // Ceilings: 3 repos × (3 × 20) = 180 > budget 90. Weights 3:1:1 split the
    // budget 54 / 18 / 18 (exact, no remainder pass needed).
    const selected: readonly RepositoryId[] = [repo("alpha"), repo("beta"), repo("gamma")];
    const weights = new Map<RepositoryId, FusionWeight>([
      [repo("alpha"), 3.0],
      [repo("beta"), 1.0],
      [repo("gamma"), 1.0],
    ]);

    const windows = allocateFetchWindows({ selected, limit: 20, weights, budget: 90 });

    const total = [...windows.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(90);
    expect(windows.get(repo("alpha"))).toBe(54);
    expect(windows.get(repo("beta"))).toBe(18);
    expect(windows.get(repo("gamma"))).toBe(18);
  });

  test("allocation is independent of the order selected ids are supplied", () => {
    const weights = new Map<RepositoryId, FusionWeight>([
      [repo("alpha"), 3.0],
      [repo("beta"), 1.0],
      [repo("gamma"), 1.0],
    ]);
    const forward = allocateFetchWindows({
      selected: [repo("alpha"), repo("beta"), repo("gamma")],
      limit: 20,
      weights,
      budget: 90,
    });
    const reversed = allocateFetchWindows({
      selected: [repo("gamma"), repo("beta"), repo("alpha")],
      limit: 20,
      weights,
      budget: 90,
    });

    expect(Object.fromEntries(reversed)).toEqual(Object.fromEntries(forward));
  });

  test("rejects a non-positive limit", () => {
    expect(() =>
      allocateFetchWindows({
        selected: ["jscholarship"],
        limit: 0,
        weights: new Map(),
        budget: 150,
      }),
    ).toThrow(RangeError);
  });
});

// ─── runUnderDeadline: completed / partial / deadline_exceeded (Req 10.5, 10.6)

describe("runUnderDeadline outcomes (Req 10.5, 10.6)", () => {
  test("dispatch that resolves before the deadline reports completed with its value", async () => {
    const outcome = await runUnderDeadline({
      dispatch: Promise.resolve("dispatched"),
      deadlineMs: MIN_DEADLINE_MS,
      snapshotPartial: () => [] as string[],
      hasPartialResults: (snapshot) => snapshot.length > 0,
    });

    expect(outcome.kind).toBe("completed");
    if (outcome.kind === "completed") {
      expect(outcome.value).toBe("dispatched");
    }
  });

  test("deadline firing with partial results reports partial carrying the snapshot (Req 10.6 first clause)", async () => {
    // A dispatch that never settles within the (clamped) 1s deadline, with one
    // adapter's results already accumulated when the timer fires.
    const accumulated = ["jscholarship-result"];
    const outcome = await runUnderDeadline({
      dispatch: new Promise<string>(() => {}),
      deadlineMs: MIN_DEADLINE_MS,
      snapshotPartial: () => accumulated,
      hasPartialResults: (snapshot) => snapshot.length > 0,
    });

    expect(outcome.kind).toBe("partial");
    if (outcome.kind === "partial") {
      expect(outcome.partial).toEqual(accumulated);
    }
  });

  test("deadline firing with no results reports deadline_exceeded (Req 10.6 second clause)", async () => {
    const outcome = await runUnderDeadline({
      dispatch: new Promise<string>(() => {}),
      deadlineMs: MIN_DEADLINE_MS,
      snapshotPartial: () => [] as string[],
      hasPartialResults: (snapshot) => snapshot.length > 0,
    });

    expect(outcome.kind).toBe("deadline_exceeded");
  });
});

describe("clampDeadlineMs clamps to the 1000–10000 ms range (Req 10.5)", () => {
  test("a value below the minimum clamps up to MIN_DEADLINE_MS", () => {
    expect(clampDeadlineMs(500)).toBe(MIN_DEADLINE_MS);
    expect(clampDeadlineMs(0)).toBe(MIN_DEADLINE_MS);
    expect(clampDeadlineMs(-5000)).toBe(MIN_DEADLINE_MS);
  });

  test("a value above the maximum clamps down to MAX_DEADLINE_MS", () => {
    expect(clampDeadlineMs(30_000)).toBe(MAX_DEADLINE_MS);
  });

  test("an in-range value is preserved (and rounded to an integer)", () => {
    expect(clampDeadlineMs(5000)).toBe(5000);
    expect(clampDeadlineMs(4999.6)).toBe(5000);
  });

  test("a non-finite value falls back to the default deadline", () => {
    expect(clampDeadlineMs(Number.NaN)).toBe(DEFAULT_DEADLINE_MS);
    expect(clampDeadlineMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DEADLINE_MS);
  });

  test("the documented bounds are internally consistent", () => {
    expect(MIN_DEADLINE_MS).toBe(1_000);
    expect(MAX_DEADLINE_MS).toBe(10_000);
    expect(DEFAULT_DEADLINE_MS).toBe(10_000);
  });
});

// ─── emitFanOutMetric: EMF shape and fan-out cap (Req 10.7) ──────────────────

describe("emitFanOutMetric (Req 10.7)", () => {
  function emitOne(event: FanOutEvent, serviceName?: string): Record<string, unknown> {
    const lines: string[] = [];
    emitFanOutMetric(event, serviceName, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  }

  test("emits DispatchFanOut and MaxAdapters dimensioned by Service", () => {
    const parsed = emitOne({ adaptersCalled: 6, maxAdapters: 8 });
    const definition = (
      parsed._aws as {
        CloudWatchMetrics: [
          {
            Namespace: string;
            Dimensions: string[][];
            Metrics: Array<{ Name: string; Unit: string }>;
          },
        ];
      }
    ).CloudWatchMetrics[0];

    expect(definition.Namespace).toBe(METRICS_NAMESPACE);
    expect(definition.Dimensions).toEqual([["Service"]]);
    expect(definition.Metrics.map((metric) => metric.Name)).toEqual([
      "DispatchFanOut",
      "MaxAdapters",
    ]);
    expect(parsed.Service).toBe("federation");
    expect(parsed.DispatchFanOut).toBe(6);
    expect(parsed.MaxAdapters).toBe(8);
  });

  test("uses the provided service name as the dimension value", () => {
    const parsed = emitOne({ adaptersCalled: 2, maxAdapters: 8 }, "search_items");
    expect(parsed.Service).toBe("search_items");
  });

  test("fan-out is capped at the configured maximum adapter count", () => {
    // A request can never dispatch more adapters than are registered, so a
    // fan-out above the ceiling is clamped down to it.
    const parsed = emitOne({ adaptersCalled: 12, maxAdapters: 8 });
    expect(parsed.DispatchFanOut).toBe(8);
    expect(parsed.MaxAdapters).toBe(8);
  });

  test("negative and non-finite counts are bounded to non-negative integers", () => {
    const parsed = emitOne({
      adaptersCalled: -3,
      maxAdapters: Number.NaN as unknown as number,
    });
    expect(parsed.DispatchFanOut).toBe(0);
    expect(parsed.MaxAdapters).toBe(0);
  });

  test("emission at the 75% alarm boundary (ceil(max * 0.75) == 6 for max 8) carries the raw fan-out", () => {
    // The alarm (infra/modules/mcp-service/observability.tf) fires at
    // ceil(maxAdapters * 0.75) via CloudWatch; this emitter only publishes the
    // raw DispatchFanOut the alarm reads. At max 8 the threshold is 6.
    const threshold = Math.ceil(8 * 0.75);
    expect(threshold).toBe(6);
    const parsed = emitOne({ adaptersCalled: threshold, maxAdapters: 8 });
    expect(parsed.DispatchFanOut).toBe(threshold);
  });

  test("metric emission failure is non-fatal (Req 11.6)", () => {
    expect(() =>
      emitFanOutMetric({ adaptersCalled: 4, maxAdapters: 8 }, "federation", () => {
        throw new Error("broken pipe");
      }),
    ).not.toThrow();
  });
});
