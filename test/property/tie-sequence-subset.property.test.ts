/**
 * Property-Based Tests: N-Way Tie_Sequence subset re-derivation
 *
 * Feature: n-repository-federation, Property 12: Tie-sequence subset re-derivation
 *
 * **Validates: Requirements 5.1, 5.5**
 *
 * The round-robin ring is the lexicographic ordering of exactly the participating
 * subset (Req 5.1), and when a query selects only a subset of registered
 * repositories the ring is re-derived from that subset alone (Req 5.5). These
 * properties assert that `deriveTieSequence(participating, startPosition).order`
 * equals the deduplicated, lexicographically-sorted selected subset, and that it
 * depends only on which ids are selected — not the order they are supplied in and
 * not any larger registered set the subset was drawn from.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { deriveTieSequence } from "../../src/federation/tie-sequence";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A repository id. The ring treats ids as opaque lexicographic sort keys, so
 * varied lowercase identifiers exercise the ordering more thoroughly than the two
 * currently registered ids while staying in the real id shape.
 */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,23}$/)
  .map((id) => id as RepositoryId);

/** A participating subset of 1–8 distinct ids (the configured max adapter count). */
const participatingArb: fc.Arbitrary<readonly RepositoryId[]> = fc.uniqueArray(repositoryIdArb, {
  minLength: 1,
  maxLength: 8,
});

/** Any seeded start position, including stale/out-of-range values. */
const startPositionArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 10_000 });

/** The deduplicated, lexicographically-sorted form of a set of ids. */
function sortedDistinct(ids: readonly RepositoryId[]): RepositoryId[] {
  return Array.from(new Set(ids)).sort();
}

/** A deterministic permutation of `ids` selected by `seed` (Fisher–Yates). */
function permute(ids: readonly RepositoryId[], seed: number): RepositoryId[] {
  const result = [...ids];
  let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i -= 1) {
    // xorshift32 for a cheap, deterministic shuffle index.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    const tmp = result[i] as RepositoryId;
    result[i] = result[j] as RepositoryId;
    result[j] = tmp;
  }
  return result;
}

// ─── Property 12: tie-sequence subset re-derivation ──────────────────────────

describe("Feature: n-repository-federation, Property 12: Tie-sequence subset re-derivation", () => {
  test("ring is exactly the deduplicated, lexicographically-sorted selected subset", () => {
    fc.assert(
      fc.property(participatingArb, startPositionArb, (participating, startPosition) => {
        const { order } = deriveTieSequence(participating, startPosition);
        expect([...order]).toEqual(sortedDistinct(participating));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("ring is independent of the order the ids are supplied in", () => {
    fc.assert(
      fc.property(
        participatingArb,
        startPositionArb,
        fc.integer({ min: 1, max: 0xffffffff }),
        (participating, startPosition, permuteSeed) => {
          const base = deriveTieSequence(participating, startPosition).order;
          const shuffled = permute(participating, permuteSeed);
          const reordered = deriveTieSequence(shuffled, startPosition).order;
          expect([...reordered]).toEqual([...base]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("duplicate supplied ids collapse to a single ring entry", () => {
    fc.assert(
      fc.property(participatingArb, startPositionArb, (participating, startPosition) => {
        const withDuplicates = [...participating, ...participating];
        const { order } = deriveTieSequence(withDuplicates, startPosition);
        expect([...order]).toEqual(sortedDistinct(participating));
        expect(new Set(order).size).toBe(order.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("selecting a subset of a larger registered set yields a ring of exactly that subset", () => {
    fc.assert(
      fc.property(
        // A larger registered set, then a non-empty subset of it drawn by a bitmask.
        fc.uniqueArray(repositoryIdArb, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 0xff }),
        startPositionArb,
        (registered, mask, startPosition) => {
          const selected = registered.filter((_, index) => (mask & (1 << index)) !== 0);
          fc.pre(selected.length > 0);

          const subsetRing = deriveTieSequence(selected, startPosition).order;

          // The ring is exactly the selected subset, re-derived from the subset (Req 5.5):
          // the larger registered set it came from never leaks into the ring.
          expect([...subsetRing]).toEqual(sortedDistinct(selected));

          const selectedSet = new Set(selected);
          for (const id of subsetRing) {
            expect(selectedSet.has(id)).toBe(true);
          }

          // Re-deriving directly from the subset (no knowledge of the full set) is identical.
          const direct = deriveTieSequence(sortedDistinct(selected), startPosition).order;
          expect([...subsetRing]).toEqual([...direct]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
