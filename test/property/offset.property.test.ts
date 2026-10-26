/**
 * Property-Based Tests: Per-Repository Offset Computation (Cursor_V2)
 *
 * Feature: n-repository-federation, Property 5: Offset computation
 *
 * **Validates: Requirements 3.10, 12.3**
 *
 * A Cursor_V2 per-repository offset is the page attempt's starting offset plus
 * the candidates consumed (passed + failed + timed-out) during the attempt,
 * clamped to `MAX_REPOSITORY_OFFSET`. These properties assert that arithmetic
 * holds across generated inputs:
 *   - below the ceiling, the returned offset equals `startOffset + passed +
 *     failed + timedOut`; and
 *   - at or beyond the ceiling, the returned offset is clamped to
 *     `MAX_REPOSITORY_OFFSET`.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  type CandidateConsumption,
  MAX_REPOSITORY_OFFSET,
  candidatesConsumed,
  computeNextOffset,
} from "../../src/federation/offset";

const NUM_RUNS = 200;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * A candidate consumption whose tallies are small enough that, combined with a
 * bounded start offset, the sum stays well below `MAX_REPOSITORY_OFFSET` and no
 * clamping occurs.
 */
const smallConsumptionArb: fc.Arbitrary<CandidateConsumption> = fc.record({
  passed: fc.integer({ min: 0, max: 10_000 }),
  failed: fc.integer({ min: 0, max: 10_000 }),
  timedOut: fc.integer({ min: 0, max: 10_000 }),
});

/** A start offset bounded so that `start + smallConsumption` never clamps. */
const smallStartOffsetArb = fc.integer({ min: 0, max: 100_000 });

/** Any valid consumption across the full non-negative integer range of interest. */
const anyConsumptionArb: fc.Arbitrary<CandidateConsumption> = fc.record({
  passed: fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET }),
  failed: fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET }),
  timedOut: fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET }),
});

/** Any valid start offset within the documented bound. */
const anyStartOffsetArb = fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET });

// ─── Property 5: offset computation ──────────────────────────────────────────

describe("Property 5: offset computation", () => {
  test("below the ceiling, the offset equals start plus consumed candidate count", () => {
    fc.assert(
      fc.property(smallStartOffsetArb, smallConsumptionArb, (startOffset, consumption) => {
        const expected =
          startOffset + consumption.passed + consumption.failed + consumption.timedOut;
        expect(expected).toBeLessThanOrEqual(MAX_REPOSITORY_OFFSET);
        expect(computeNextOffset(startOffset, consumption)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the offset equals min(start + consumed, MAX_REPOSITORY_OFFSET) for any valid input", () => {
    fc.assert(
      fc.property(anyStartOffsetArb, anyConsumptionArb, (startOffset, consumption) => {
        const consumed = consumption.passed + consumption.failed + consumption.timedOut;
        const expected = Math.min(startOffset + consumed, MAX_REPOSITORY_OFFSET);
        expect(computeNextOffset(startOffset, consumption)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("when start plus consumed exceeds the ceiling, the result is clamped", () => {
    // Force an overflow: start offset at least half the ceiling, plus a
    // consumption guaranteed to push the sum past MAX_REPOSITORY_OFFSET.
    const overflowStartArb = fc.integer({
      min: MAX_REPOSITORY_OFFSET / 2,
      max: MAX_REPOSITORY_OFFSET,
    });
    const overflowConsumptionArb: fc.Arbitrary<CandidateConsumption> = fc.record({
      passed: fc.integer({ min: MAX_REPOSITORY_OFFSET, max: MAX_REPOSITORY_OFFSET * 2 }),
      failed: fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET }),
      timedOut: fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET }),
    });
    fc.assert(
      fc.property(overflowStartArb, overflowConsumptionArb, (startOffset, consumption) => {
        expect(startOffset + candidatesConsumed(consumption)).toBeGreaterThan(
          MAX_REPOSITORY_OFFSET,
        );
        expect(computeNextOffset(startOffset, consumption)).toBe(MAX_REPOSITORY_OFFSET);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the result never falls below the start offset and never exceeds the ceiling", () => {
    fc.assert(
      fc.property(anyStartOffsetArb, anyConsumptionArb, (startOffset, consumption) => {
        const next = computeNextOffset(startOffset, consumption);
        expect(next).toBeLessThanOrEqual(MAX_REPOSITORY_OFFSET);
        expect(next).toBeGreaterThanOrEqual(Math.min(startOffset, MAX_REPOSITORY_OFFSET));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("zero consumption leaves the offset at the (bounded) start", () => {
    fc.assert(
      fc.property(anyStartOffsetArb, (startOffset) => {
        const consumption: CandidateConsumption = { passed: 0, failed: 0, timedOut: 0 };
        expect(computeNextOffset(startOffset, consumption)).toBe(
          Math.min(startOffset, MAX_REPOSITORY_OFFSET),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
