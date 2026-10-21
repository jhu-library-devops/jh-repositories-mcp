/**
 * Property-Based Tests: N-Way Tie_Sequence fairness and advance
 *
 * Feature: n-repository-federation, Property 11: Tie-sequence fairness and advance
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 *
 * The tie sequence is a lexicographic round-robin over the participating subset
 * (Req 5.1). On a tie the repository at the current position wins (Req 5.2) and
 * the position then advances one step, wrapping to zero after the last id
 * (Req 5.3). Taken together these mean that over N consecutive ties for a subset
 * of size N, each participating repository is selected exactly once — the ring is
 * fair and never favors or starves a repository. These properties assert that
 * fairness and the wrap behavior from any starting position.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { advanceTie, deriveTieSequence, tieWinner } from "../../src/federation/tie-sequence";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A repository id. The ring treats ids as opaque lexicographic sort keys, so
 * varied lowercase identifiers exercise the ordering more thoroughly than the
 * two currently registered ids while staying in the real id shape.
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

/** Collect the winners of `count` consecutive ties, advancing after each. */
function collectWinners(
  participating: readonly RepositoryId[],
  startPosition: number,
  count: number,
): RepositoryId[] {
  let sequence = deriveTieSequence(participating, startPosition);
  const winners: RepositoryId[] = [];
  for (let i = 0; i < count; i += 1) {
    winners.push(tieWinner(sequence));
    sequence = advanceTie(sequence);
  }
  return winners;
}

// ─── Property 11: tie-sequence fairness and advance ──────────────────────────

describe("Feature: n-repository-federation, Property 11: Tie-sequence fairness and advance", () => {
  test("over N consecutive ties each participating repository is selected exactly once", () => {
    fc.assert(
      fc.property(participatingArb, startPositionArb, (participating, startPosition) => {
        const sorted = Array.from(new Set(participating)).sort();
        const winners = collectWinners(participating, startPosition, sorted.length);

        // Fairness: the N winners are a permutation of the full participating set.
        expect([...winners].sort()).toEqual(sorted);
        expect(new Set(winners).size).toBe(sorted.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("selection is a lexicographic round-robin with one-step advance and wrap", () => {
    fc.assert(
      fc.property(participatingArb, startPositionArb, (participating, startPosition) => {
        const sorted = Array.from(new Set(participating)).sort();
        const n = sorted.length;

        // The seeded start normalizes into [0, n) the same way the ring does.
        const start = ((startPosition % n) + n) % n;

        // Walk two full laps to exercise the wrap from the last id back to the first.
        const winners = collectWinners(participating, startPosition, n * 2);
        for (let step = 0; step < winners.length; step += 1) {
          const expected = sorted[(start + step) % n];
          expect(winners[step]).toBe(expected as RepositoryId);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("over T = N consecutive ties for T a multiple of N, selections stay balanced", () => {
    fc.assert(
      fc.property(
        participatingArb,
        startPositionArb,
        fc.integer({ min: 1, max: 5 }),
        (participating, startPosition, laps) => {
          const sorted = Array.from(new Set(participating)).sort();
          const n = sorted.length;
          const winners = collectWinners(participating, startPosition, n * laps);

          // Each repository is selected exactly `laps` times — no favoring, no starving.
          const counts = new Map<RepositoryId, number>();
          for (const winner of winners) {
            counts.set(winner, (counts.get(winner) ?? 0) + 1);
          }
          expect(counts.size).toBe(n);
          for (const id of sorted) {
            expect(counts.get(id as RepositoryId)).toBe(laps);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
