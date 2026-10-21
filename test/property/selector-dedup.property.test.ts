/**
 * Property-Based Tests: Repository Selector Deduplication
 *
 * Feature: n-repository-federation, Property 15: Selector deduplication
 *
 * **Validates: Requirements 2.3**
 *
 * An array `repositories` selector may arrive with arbitrary duplicates and in
 * any order. `resolveSelector` must collapse it to the distinct set of
 * RepositoryIds so no repository is dispatched to twice, and must present that
 * set lexicographically sorted for deterministic downstream cursor construction
 * and tie-sequence derivation (design.md §2 Repository Selector).
 *
 * These properties assert, across randomized arrays of registered ids with
 * injected duplicates and shuffled order:
 *   - the resolution never rejects (every generated id is registered);
 *   - `selected` contains no id more than once (no double dispatch);
 *   - `selected` equals the distinct set of the input, independent of order;
 *   - `selected` is lexicographically sorted; and
 *   - resolution is order-invariant (a shuffle yields the identical set).
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  type AdapterRegistry,
  isSelectorRejection,
  resolveSelector,
} from "../../src/federation/selector";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

/**
 * Build a structural `AdapterRegistry` double from the ids it knows about.
 *
 * Mirrors the double in `test/unit/selector.test.ts`: `registered` are the ids
 * present in the registry (treated as a set so the double imposes no ordering),
 * and `eligible` defaults to all registered ids. The selector owns sorting and
 * deduplication, so the double deliberately does neither.
 */
function buildRegistryDouble(
  registered: readonly RepositoryId[],
  eligible: readonly RepositoryId[] = registered,
): AdapterRegistry {
  const registeredSet: ReadonlySet<RepositoryId> = new Set(registered);
  return {
    registeredIds(): readonly RepositoryId[] {
      return registered;
    },
    eligibleIds(): readonly RepositoryId[] {
      return eligible;
    },
    has(id: RepositoryId): boolean {
      return registeredSet.has(id);
    },
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A lowercase repository id drawn from the base64url-safe alphabet [a-z0-9]. */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .string({
    minLength: 2,
    maxLength: 8,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
  })
  .filter((value) => value.length >= 2) as fc.Arbitrary<RepositoryId>;

/**
 * Generate a non-empty distinct pool of registered ids, then an array selector
 * drawn from that pool with arbitrary duplicates and order. Returning both lets
 * properties assert against the exact distinct set the selector should produce.
 */
const arraySelectorCaseArb = fc
  .uniqueArray(repositoryIdArb, { minLength: 1, maxLength: 8 })
  .chain((registered) =>
    fc.record({
      registered: fc.constant(registered),
      // Draw 1–24 ids from the registered pool so duplicates are likely and the
      // array length is unrelated to the distinct count.
      selector: fc.array(fc.constantFrom(...registered), { minLength: 1, maxLength: 24 }),
    }),
  );

/** Expected distinct, lexicographically-sorted set of the input ids. */
function distinctSorted(ids: readonly RepositoryId[]): RepositoryId[] {
  return Array.from(new Set(ids)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ─── Property 15: selector deduplication ─────────────────────────────────────

describe("Property 15: selector deduplication", () => {
  test("an array selector of registered ids never rejects", () => {
    fc.assert(
      fc.property(arraySelectorCaseArb, ({ registered, selector }) => {
        const registry = buildRegistryDouble(registered);
        const result = resolveSelector(selector, registry);
        expect(isSelectorRejection(result)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("no repository appears twice in the resolved set", () => {
    fc.assert(
      fc.property(arraySelectorCaseArb, ({ registered, selector }) => {
        const registry = buildRegistryDouble(registered);
        const result = resolveSelector(selector, registry);
        if (isSelectorRejection(result)) {
          throw new Error("expected a resolution, got a rejection");
        }
        const distinct = new Set(result.selected);
        expect(result.selected.length).toBe(distinct.size);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the resolved set equals the distinct set of the input", () => {
    fc.assert(
      fc.property(arraySelectorCaseArb, ({ registered, selector }) => {
        const registry = buildRegistryDouble(registered);
        const result = resolveSelector(selector, registry);
        if (isSelectorRejection(result)) {
          throw new Error("expected a resolution, got a rejection");
        }
        expect([...result.selected]).toEqual(distinctSorted(selector));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the resolved set is lexicographically sorted", () => {
    fc.assert(
      fc.property(arraySelectorCaseArb, ({ registered, selector }) => {
        const registry = buildRegistryDouble(registered);
        const result = resolveSelector(selector, registry);
        if (isSelectorRejection(result)) {
          throw new Error("expected a resolution, got a rejection");
        }
        const sorted = [...result.selected].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect([...result.selected]).toEqual(sorted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("resolution is independent of the order the ids are supplied", () => {
    fc.assert(
      fc.property(
        arraySelectorCaseArb,
        fc.infiniteStream(fc.integer()),
        ({ registered, selector }, seeds) => {
          const registry = buildRegistryDouble(registered);
          // Deterministically shuffle the selector from the stream of seeds.
          const shuffled = [...selector];
          const seedIter = seeds[Symbol.iterator]();
          for (let i = shuffled.length - 1; i > 0; i--) {
            const next = seedIter.next().value ?? 0;
            const j = Math.abs(next) % (i + 1);
            const tmp = shuffled[i] as RepositoryId;
            shuffled[i] = shuffled[j] as RepositoryId;
            shuffled[j] = tmp;
          }

          const forward = resolveSelector(selector, registry);
          const reordered = resolveSelector(shuffled, registry);
          if (isSelectorRejection(forward) || isSelectorRejection(reordered)) {
            throw new Error("expected resolutions, got a rejection");
          }
          expect([...reordered.selected]).toEqual([...forward.selected]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
