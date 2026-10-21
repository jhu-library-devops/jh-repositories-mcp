/**
 * Property-Based Tests: N-Way merge determinism under page-order reordering
 *
 * Feature: n-repository-federation, Property 7: Merge determinism under reordering
 *
 * **Validates: Requirements 4.3, 5.6**
 *
 * The N-way reciprocal-rank merge orders results by descending fusion score and
 * breaks equal-score ties through the Tie_Sequence at a fixed carried position
 * (Req 4.3). Because the merge derives its ordering purely from each record's
 * rank, the configured weights, and the lexicographic Tie_Sequence ring, the
 * result ordering must not depend on the order the adapter pages were supplied —
 * that is, on the order in which adapter responses arrive (Req 5.6).
 *
 * `MergeInput.pages` is a `ReadonlyMap<RepositoryId, RepositoryPage>`, and Map
 * iteration order follows insertion order. This property builds the same set of
 * per-repository pages, then constructs the pages Map from those entries in many
 * different (shuffled) insertion orders, and asserts `mergePages` returns the
 * identical ordered list of result ids every time for a fixed cursor
 * `nextTieSequence`.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { CursorV2 } from "../../src/federation/cursor";
import { type FusionConfig, type MergeInput, mergePages } from "../../src/federation/merge";
import { createRepositoryRecord } from "../../src/models/index";
import type { RepositoryId, RepositoryPage, RepositoryRecord } from "../../src/models/index";

const NUM_RUNS = 200;

// ─── Builders ────────────────────────────────────────────────────────────────

/**
 * A repository id. The merge treats ids as opaque lexicographic sort keys, so
 * varied lowercase identifiers exercise the ordering and tie-break ring more
 * thoroughly than the two currently registered ids while keeping the real id
 * shape.
 */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,15}$/)
  .map((id) => id as RepositoryId);

/** A single rank-ordered record carrying a 1-based `sourceRank`. */
function record(repository: RepositoryId, rank: number): RepositoryRecord {
  return {
    ...createRepositoryRecord({
      platformId: `item-${rank}`,
      repository,
      kind: "repository_item",
      title: `Record ${repository} ${rank}`,
      landingPageUrl: "https://example.jhu.edu/x",
      provenance: {
        platform: "dspace",
        platformRecordId: `item-${rank}`,
        canonicalApi: "dspace_rest",
        retrievedAt: "2026-07-29T00:00:00.000Z",
      },
    }),
    sourceRank: rank,
  };
}

/**
 * Build a page for `repository` whose results carry 1-based `sourceRank`s
 * `1..count` in ascending order — the adapter's own validated ordering.
 */
function page(repository: RepositoryId, count: number): RepositoryPage {
  const ranks = Array.from({ length: count }, (_, i) => i + 1);
  return {
    repository,
    results: ranks.map((rank) => record(repository, rank)),
    nextOffset: null,
    totalCandidates: count,
    validationOmissions: 0,
    warnings: [],
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A plan for one merge: 2–8 distinct repositories, each with a rank-ordered page
 * of 1–6 records, a fixed RRF `k`, integer weights per repository, a page limit,
 * and a fixed carried tie-sequence position.
 */
interface MergePlan {
  readonly entries: ReadonlyArray<readonly [RepositoryId, RepositoryPage]>;
  readonly weights: ReadonlyMap<RepositoryId, number>;
  readonly k: number;
  readonly limit: number;
  readonly nextTieSequence: number;
}

const mergePlanArb: fc.Arbitrary<MergePlan> = fc
  .uniqueArray(repositoryIdArb, { minLength: 2, maxLength: 8 })
  .chain((repositories) =>
    fc.record({
      repositories: fc.constant(repositories),
      counts: fc.array(fc.integer({ min: 1, max: 6 }), {
        minLength: repositories.length,
        maxLength: repositories.length,
      }),
      // Small integer weight set so equal fusion scores (and therefore the
      // Tie_Sequence) are frequently exercised across repositories.
      weights: fc.array(fc.integer({ min: 1, max: 3 }), {
        minLength: repositories.length,
        maxLength: repositories.length,
      }),
      k: fc.integer({ min: 1, max: 1000 }),
      limit: fc.integer({ min: 1, max: 40 }),
      nextTieSequence: fc.integer({ min: 0, max: 10_000 }),
    }),
  )
  .map(({ repositories, counts, weights, k, limit, nextTieSequence }) => {
    const entries = repositories.map(
      (repository, i) => [repository, page(repository, counts[i] as number)] as const,
    );
    const weightMap = new Map<RepositoryId, number>(
      repositories.map((repository, i) => [repository, weights[i] as number]),
    );
    return { entries, weights: weightMap, k, limit, nextTieSequence };
  });

/** A permutation of `items` driven by a fast-check-provided shuffle. */
function permutationArb<Element>(items: readonly Element[]): fc.Arbitrary<readonly Element[]> {
  return fc.shuffledSubarray([...items], {
    minLength: items.length,
    maxLength: items.length,
  });
}

// ─── Merge driver ──────────────────────────────────────────────────────────

/** Run the merge for a given page insertion order and return the result ids. */
function mergedIdsFor(
  plan: MergePlan,
  entries: ReadonlyArray<readonly [RepositoryId, RepositoryPage]>,
): string[] {
  const participating = plan.entries.map(([repository]) => repository);
  const cursor: CursorV2 = {
    v: 2,
    queryHash: "0123456789abcdef",
    offsets: [],
    participating: [...participating].sort(),
    nextTieSequence: plan.nextTieSequence,
  };
  const fusion: FusionConfig = { k: plan.k, weights: plan.weights };
  const input: MergeInput = {
    pages: new Map(entries),
    participating,
    cursor,
    limit: plan.limit,
    fusion,
    queryHash: cursor.queryHash,
  };
  return mergePages(input).results.map((result) => result.id);
}

// ─── Property 7: merge determinism under reordering ──────────────────────────

describe("Feature: n-repository-federation, Property 7: Merge determinism under reordering", () => {
  test("result ordering is identical regardless of the order adapter pages are supplied", () => {
    fc.assert(
      fc.property(
        mergePlanArb.chain((plan) =>
          fc.record({
            plan: fc.constant(plan),
            // Several independent shuffles of the same page entries. Map iteration
            // order follows insertion order, so each shuffle feeds the merge a
            // different adapter-response arrival order.
            orders: fc.array(permutationArb(plan.entries), { minLength: 2, maxLength: 5 }),
          }),
        ),
        ({ plan, orders }) => {
          const baseline = mergedIdsFor(plan, plan.entries);

          // Sanity: the merge produced a non-empty, bounded page for real inputs.
          expect(baseline.length).toBeGreaterThan(0);
          expect(baseline.length).toBeLessThanOrEqual(plan.limit);

          for (const order of orders) {
            expect(mergedIdsFor(plan, order)).toEqual(baseline);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
