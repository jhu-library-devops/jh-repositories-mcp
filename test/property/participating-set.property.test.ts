/**
 * Property-Based Tests: Participating set carried in the emitted cursor payload
 *
 * Feature: n-repository-federation, Property 6: Participating set carried in payload
 *
 * **Validates: Requirements 3.1, 12.6**
 *
 * The Cursor_V2 payload carries the set of participating RepositoryIds so that
 * set-change detection depends only on the payload and not on any external state
 * (Req 3.1, 12.6). The N-way merge emits that payload: `mergePages` stamps
 * `nextCursor.participating` with the participating set it was given, sorted and
 * deduplicated, independent of which repositories contributed results on this
 * page. The reconciliation step (`reconcileParticipatingSet`) likewise rewrites a
 * decoded cursor's `participating` to the current participating set.
 *
 * This property generates a participating set (1–8 distinct ids) plus a
 * rank-ordered page per repository, runs `mergePages`, and asserts that whenever
 * the emitted `nextCursor` is non-null its `participating` field equals the
 * sorted-distinct participating set passed in — so the participating set travels
 * in the payload verbatim. It also confirms `reconcileParticipatingSet` carries
 * the current participating set into its reconciled cursor.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { CursorV2 } from "../../src/federation/cursor";
import { type FusionConfig, type MergeInput, mergePages } from "../../src/federation/merge";
import { reconcileParticipatingSet } from "../../src/federation/reconcile";
import { createRepositoryRecord } from "../../src/models/index";
import type { RepositoryId, RepositoryPage, RepositoryRecord } from "../../src/models/index";

const NUM_RUNS = 200;

const QUERY_HASH = "0123456789abcdef";

// ─── Builders ────────────────────────────────────────────────────────────────

/**
 * A repository id. The merge and reconciler treat ids as opaque lexicographic
 * sort keys, so varied lowercase identifiers exercise the sort/dedupe path more
 * thoroughly than the two currently registered ids while keeping the real id
 * shape (mirrors `test/property/merge-determinism.property.test.ts`).
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
 * `1..count` in ascending order — the adapter's own validated ordering. A
 * non-null `nextOffset` keeps the repository contributing so the emitted cursor
 * is non-null and carries the participating payload.
 */
function page(repository: RepositoryId, count: number, nextOffset: number | null): RepositoryPage {
  const ranks = Array.from({ length: count }, (_, i) => i + 1);
  return {
    repository,
    results: ranks.map((rank) => record(repository, rank)),
    nextOffset,
    totalCandidates: count + (nextOffset ?? 0),
    validationOmissions: 0,
    warnings: [],
  };
}

/** Sorted-distinct ids — the canonical participating-set form the payload carries. */
function sortedDistinct(ids: readonly RepositoryId[]): RepositoryId[] {
  return Array.from(new Set(ids)).sort();
}

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A plan for one merge: 1–8 distinct participating repositories, each with a
 * rank-ordered page of 1–6 records and a `nextOffset` that is usually non-null
 * (so the emitted cursor is non-null), integer weights, an RRF `k`, a page
 * limit, and a carried tie-sequence position.
 */
interface MergePlan {
  readonly participating: readonly RepositoryId[];
  readonly entries: ReadonlyArray<readonly [RepositoryId, RepositoryPage]>;
  readonly weights: ReadonlyMap<RepositoryId, number>;
  readonly k: number;
  readonly limit: number;
  readonly nextTieSequence: number;
}

const mergePlanArb: fc.Arbitrary<MergePlan> = fc
  .uniqueArray(repositoryIdArb, { minLength: 1, maxLength: 8 })
  .chain((repositories) =>
    fc.record({
      repositories: fc.constant(repositories),
      counts: fc.array(fc.integer({ min: 1, max: 6 }), {
        minLength: repositories.length,
        maxLength: repositories.length,
      }),
      // A non-null offset for at least most repositories keeps the next cursor
      // non-null; `null` for some exercises the contributing-only omission path
      // without changing the participating payload.
      offsets: fc.array(fc.option(fc.integer({ min: 1, max: 5000 }), { nil: null }), {
        minLength: repositories.length,
        maxLength: repositories.length,
      }),
      weights: fc.array(fc.integer({ min: 1, max: 3 }), {
        minLength: repositories.length,
        maxLength: repositories.length,
      }),
      k: fc.integer({ min: 1, max: 1000 }),
      limit: fc.integer({ min: 1, max: 40 }),
      nextTieSequence: fc.integer({ min: 0, max: 10_000 }),
    }),
  )
  .map(({ repositories, counts, offsets, weights, k, limit, nextTieSequence }) => {
    const entries = repositories.map(
      (repository, i) =>
        [repository, page(repository, counts[i] as number, offsets[i] as number | null)] as const,
    );
    const weightMap = new Map<RepositoryId, number>(
      repositories.map((repository, i) => [repository, weights[i] as number]),
    );
    return { participating: repositories, entries, weights: weightMap, k, limit, nextTieSequence };
  });

/** Assemble the `MergeInput` from a plan. */
function mergeInputFor(plan: MergePlan): MergeInput {
  const cursor: CursorV2 = {
    v: 2,
    queryHash: QUERY_HASH,
    offsets: [],
    participating: sortedDistinct(plan.participating),
    nextTieSequence: plan.nextTieSequence,
  };
  const fusion: FusionConfig = { k: plan.k, weights: plan.weights };
  return {
    pages: new Map(plan.entries),
    participating: plan.participating,
    cursor,
    limit: plan.limit,
    fusion,
    queryHash: QUERY_HASH,
  };
}

// ─── Property 6: participating set carried in payload ─────────────────────────

describe("Feature: n-repository-federation, Property 6: Participating set carried in payload", () => {
  test("the emitted cursor's participating set equals the sorted-distinct participating set", () => {
    fc.assert(
      fc.property(mergePlanArb, (plan) => {
        const expected = sortedDistinct(plan.participating);
        const { nextCursor } = mergePages(mergeInputFor(plan));

        // Set-change detection reads only the payload: when a cursor is emitted,
        // its participating set must equal the set that participated (Req 3.1, 12.6).
        if (nextCursor !== null) {
          expect(nextCursor.participating).toEqual(expected);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("reconciliation carries the current participating set into the reconciled cursor", () => {
    fc.assert(
      fc.property(mergePlanArb, (plan) => {
        const expected = sortedDistinct(plan.participating);
        // A decoded cursor whose offsets match the current participating set and
        // whose query hash matches, so reconciliation keeps the set and rewrites
        // the payload's participating field to the current sorted-distinct set.
        const decoded: CursorV2 = {
          v: 2,
          queryHash: QUERY_HASH,
          offsets: expected.map((id) => [id, 0] as const),
          participating: expected,
          nextTieSequence: plan.nextTieSequence,
        };

        const { cursor } = reconcileParticipatingSet(decoded, plan.participating, QUERY_HASH);

        expect(cursor.participating).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
