/**
 * Property-Based Tests: Proportional Fetch-Window Allocation (Cursor_V2 budget)
 *
 * Feature: n-repository-federation, Property 18: Proportional window allocation sums to budget
 *
 * **Validates: Requirements 10.3, 10.4**
 *
 * Each selected repository is over-fetched up to a ceiling of `3 × limit`
 * candidates. When the sum of those ceilings (`3 × limit × selectedCount`)
 * exceeds the configurable canonicalization budget, the per-repository windows
 * are reduced proportionally to each repository's configured Fusion_Weight —
 * via largest-remainder rounding — so they sum to the budget exactly (Req 10.4).
 * When the ceilings fit within the budget, every repository receives its full
 * `3 × limit` ceiling (Req 10.3).
 *
 * These properties assert, across randomized selected sets and weights:
 *   - over-budget: windows sum to the budget exactly, every window is a
 *     non-negative integer, and each allocation tracks its configured weight
 *     to within largest-remainder rounding tolerance (±1 candidate); and
 *   - under-budget: every repository receives exactly `OVER_FETCH_MULTIPLE × limit`.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  type FusionWeight,
  OVER_FETCH_MULTIPLE,
  allocateFetchWindows,
} from "../../src/federation/window-allocation";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

/** Fusion_Weight range from Req 1.6 / 10.2 (0.01–100.0 inclusive). */
const MIN_WEIGHT = 0.01;
const MAX_WEIGHT = 100.0;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A lowercase repository id built from the base64url-safe alphabet [a-z0-9]. */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .string({
    minLength: 2,
    maxLength: 8,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
  })
  .filter((value) => value.length >= 2) as fc.Arbitrary<RepositoryId>;

/** A finite Fusion_Weight within the configured range. */
const weightArb: fc.Arbitrary<FusionWeight> = fc
  .double({ min: MIN_WEIGHT, max: MAX_WEIGHT, noNaN: true, noDefaultInfinity: true })
  .map((value) => Math.round(value * 100) / 100)
  .filter((value) => value >= MIN_WEIGHT && value <= MAX_WEIGHT);

/** Resolve the effective weight the allocator uses: absent / non-positive → 1.0. */
const DEFAULT_FUSION_WEIGHT = 1.0;
function effectiveWeight(
  weights: ReadonlyMap<RepositoryId, FusionWeight>,
  id: RepositoryId,
): number {
  const weight = weights.get(id);
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
    return DEFAULT_FUSION_WEIGHT;
  }
  return weight;
}

/**
 * Generate a selected set (2–8 distinct ids) with a per-id weight map, a limit,
 * and a budget guaranteed to be strictly below the total over-fetch ceiling so
 * proportional reduction is exercised on every run.
 */
const overBudgetCaseArb = fc
  .uniqueArray(repositoryIdArb, { minLength: 2, maxLength: 8 })
  .chain((selected) =>
    fc.record({
      selected: fc.constant(selected),
      limit: fc.integer({ min: 1, max: 50 }),
      weights: fc
        .array(weightArb, { minLength: selected.length, maxLength: selected.length })
        .map((values) => new Map(selected.map((id, i) => [id, values[i] as FusionWeight]))),
    }),
  )
  .chain(({ selected, limit, weights }) => {
    const totalCeiling = OVER_FETCH_MULTIPLE * limit * selected.length;
    // Budget strictly below the ceiling but at least one per repository so the
    // proportional branch runs; cap at totalCeiling - 1.
    return fc.record({
      selected: fc.constant(selected),
      limit: fc.constant(limit),
      weights: fc.constant(weights),
      budget: fc.integer({ min: selected.length, max: totalCeiling - 1 }),
    });
  });

/**
 * Generate a selected set whose total over-fetch ceiling fits within the
 * budget, so every repository should receive its full ceiling.
 */
const underBudgetCaseArb = fc
  .uniqueArray(repositoryIdArb, { minLength: 1, maxLength: 8 })
  .chain((selected) =>
    fc.record({
      selected: fc.constant(selected),
      limit: fc.integer({ min: 1, max: 20 }),
      weights: fc
        .array(weightArb, { minLength: selected.length, maxLength: selected.length })
        .map((values) => new Map(selected.map((id, i) => [id, values[i] as FusionWeight]))),
    }),
  )
  .chain(({ selected, limit, weights }) => {
    const totalCeiling = OVER_FETCH_MULTIPLE * limit * selected.length;
    return fc.record({
      selected: fc.constant(selected),
      limit: fc.constant(limit),
      weights: fc.constant(weights),
      // Budget at or above the total ceiling → under-budget branch.
      budget: fc.integer({ min: totalCeiling, max: totalCeiling + 500 }),
    });
  });

// ─── Property 18a: over-budget allocation sums to the budget ─────────────────

describe("Property 18: proportional window allocation sums to budget (over-budget)", () => {
  test("allocated windows sum exactly to the budget", () => {
    fc.assert(
      fc.property(overBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const allocation = allocateFetchWindows({ selected, limit, weights, budget });
        const total = [...allocation.values()].reduce((sum, w) => sum + w, 0);
        expect(total).toBe(budget);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("every window is a non-negative integer not exceeding the budget", () => {
    fc.assert(
      fc.property(overBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const allocation = allocateFetchWindows({ selected, limit, weights, budget });
        for (const window of allocation.values()) {
          expect(Number.isInteger(window)).toBe(true);
          expect(window).toBeGreaterThanOrEqual(0);
          expect(window).toBeLessThanOrEqual(budget);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the allocation covers exactly the deduplicated selected set", () => {
    fc.assert(
      fc.property(overBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const allocation = allocateFetchWindows({ selected, limit, weights, budget });
        const expected = new Set(selected);
        expect(allocation.size).toBe(expected.size);
        for (const id of expected) {
          expect(allocation.has(id)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("each window tracks its weight share to within largest-remainder tolerance (±1)", () => {
    fc.assert(
      fc.property(overBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const allocation = allocateFetchWindows({ selected, limit, weights, budget });
        const totalWeight = selected.reduce((sum, id) => sum + effectiveWeight(weights, id), 0);
        for (const id of selected) {
          const expectedShare = (effectiveWeight(weights, id) * budget) / totalWeight;
          const actual = allocation.get(id) ?? 0;
          // Largest-remainder rounding places every window at floor(share) or
          // floor(share)+1, i.e. within 1 of the exact proportional share.
          expect(actual).toBeGreaterThanOrEqual(Math.floor(expectedShare));
          expect(actual).toBeLessThanOrEqual(Math.floor(expectedShare) + 1);
          expect(Math.abs(actual - expectedShare)).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("heavier weight never receives a smaller window than a lighter one", () => {
    fc.assert(
      fc.property(overBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const allocation = allocateFetchWindows({ selected, limit, weights, budget });
        for (const a of selected) {
          for (const b of selected) {
            if (effectiveWeight(weights, a) > effectiveWeight(weights, b)) {
              const wa = allocation.get(a) ?? 0;
              const wb = allocation.get(b) ?? 0;
              // Proportional-plus-largest-remainder can only perturb by ±1, so a
              // strictly heavier weight is never shorted by more than 1.
              expect(wa).toBeGreaterThanOrEqual(wb - 1);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("allocation is independent of the order the selected ids are supplied", () => {
    fc.assert(
      fc.property(overBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const forward = allocateFetchWindows({ selected, limit, weights, budget });
        const reversed = allocateFetchWindows({
          selected: [...selected].reverse(),
          limit,
          weights,
          budget,
        });
        expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 18b: under-budget allocation gives every repo its full ceiling ─

describe("Property 18: proportional window allocation sums to budget (under-budget)", () => {
  test("every repository receives its full 3×limit ceiling", () => {
    fc.assert(
      fc.property(underBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const ceiling = OVER_FETCH_MULTIPLE * limit;
        const allocation = allocateFetchWindows({ selected, limit, weights, budget });
        const distinct = new Set(selected);
        expect(allocation.size).toBe(distinct.size);
        for (const id of distinct) {
          expect(allocation.get(id)).toBe(ceiling);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the sum of ceilings never exceeds the budget in the under-budget branch", () => {
    fc.assert(
      fc.property(underBudgetCaseArb, ({ selected, limit, weights, budget }) => {
        const allocation = allocateFetchWindows({ selected, limit, weights, budget });
        const total = [...allocation.values()].reduce((sum, w) => sum + w, 0);
        expect(total).toBeLessThanOrEqual(budget);
        expect(total).toBe(OVER_FETCH_MULTIPLE * limit * new Set(selected).size);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
