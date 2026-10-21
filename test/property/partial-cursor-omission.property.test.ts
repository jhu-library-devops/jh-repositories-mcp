/**
 * Property-Based Tests: Partial-result cursor omits failed repositories
 *
 * Feature: n-repository-federation, Property 14: Partial-result cursor omits failed repositories
 *
 * **Validates: Requirements 6.5, 6.6**
 *
 * When some selected repositories contribute a page and others fail or go
 * absent, the emitted `Cursor_V2` must carry per-repository offsets only for the
 * repositories that actually contributed a non-exhausted page. A failed or
 * absent repository has no page in `MergeInput.pages`, so the next-cursor builder
 * never records an offset for it; on the following page that repository
 * re-attempts from its last successfully recorded offset — or from zero when no
 * offset was ever recorded (Req 6.5). Because the offset map omits it entirely,
 * the recovered repository is never fast-forwarded past positions it never
 * examined (Req 6.6).
 *
 * `mergePages` builds the next cursor's `offsets` from exactly those pages whose
 * `nextOffset` is non-null — the contributing repositories. This property
 * generates merges where a subset of the participating repositories contribute
 * pages (non-null `nextOffset`) and the rest are absent (failed) or present but
 * exhausted (`nextOffset === null`), runs `mergePages`, and asserts the emitted
 * `nextCursor.offsets` keys are a subset of the contributing repositories and
 * contain no failed repository id.
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
 * varied lowercase identifiers exercise cursor emission across many distinct
 * participating sets while keeping the real id shape.
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
 * Build a contributing page for `repository`: `count` rank-ordered records and a
 * non-null `nextOffset`, so `buildNextCursor` records an offset for it.
 */
function contributingPage(
  repository: RepositoryId,
  count: number,
  nextOffset: number,
): RepositoryPage {
  const ranks = Array.from({ length: count }, (_, i) => i + 1);
  return {
    repository,
    results: ranks.map((rank) => record(repository, rank)),
    nextOffset,
    totalCandidates: count,
    validationOmissions: 0,
    warnings: [],
  };
}

/**
 * Build an exhausted page for `repository`: it may carry records, but its
 * `nextOffset` is null, so the next cursor omits it (nothing more to fetch).
 */
function exhaustedPage(repository: RepositoryId, count: number): RepositoryPage {
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
 * How each participating repository behaves on this page:
 *   - `contributing` — returned a page with a non-null next offset.
 *   - `exhausted`    — returned a page but reported no further positions.
 *   - `failed`       — has no page in the input at all (backend failure/absent).
 */
type Behavior = "contributing" | "exhausted" | "failed";

/**
 * A partial-result merge plan: a distinct participating set, a behavior per
 * repository that guarantees at least two contributing and at least one failed
 * repository, plus fusion and pagination parameters.
 */
interface PartialPlan {
  readonly participating: readonly RepositoryId[];
  readonly behaviors: ReadonlyMap<RepositoryId, Behavior>;
  readonly contributing: readonly RepositoryId[];
  readonly failed: readonly RepositoryId[];
  readonly counts: ReadonlyMap<RepositoryId, number>;
  readonly offsets: ReadonlyMap<RepositoryId, number>;
  readonly weights: ReadonlyMap<RepositoryId, number>;
  readonly k: number;
  readonly limit: number;
  readonly nextTieSequence: number;
}

const partialPlanArb: fc.Arbitrary<PartialPlan> = fc
  // 3–8 repositories so we can guarantee ≥2 contributing and ≥1 failed and still
  // avoid the single-responder passthrough path (which also omits failed repos).
  .uniqueArray(repositoryIdArb, { minLength: 3, maxLength: 8 })
  .chain((repositories) =>
    fc.record({
      repositories: fc.constant(repositories),
      // A behavior per repository; corrected below to meet the invariants.
      behaviors: fc.array(fc.constantFrom<Behavior>("contributing", "exhausted", "failed"), {
        minLength: repositories.length,
        maxLength: repositories.length,
      }),
      counts: fc.array(fc.integer({ min: 1, max: 6 }), {
        minLength: repositories.length,
        maxLength: repositories.length,
      }),
      pageOffsets: fc.array(fc.integer({ min: 0, max: 1_000_000 }), {
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
  .map(({ repositories, behaviors, counts, pageOffsets, weights, k, limit, nextTieSequence }) => {
    // Force the invariants: the first two repositories contribute and the last
    // one fails, regardless of what the generator produced. Everything in
    // between keeps its generated behavior, so exhausted/failed/contributing mix
    // freely across the remaining repositories.
    const forced: Behavior[] = repositories.map((_, i) => behaviors[i] as Behavior);
    forced[0] = "contributing";
    forced[1] = "contributing";
    forced[repositories.length - 1] = "failed";

    const behaviorMap = new Map<RepositoryId, Behavior>(
      repositories.map((repository, i) => [repository, forced[i] as Behavior]),
    );
    const countMap = new Map<RepositoryId, number>(
      repositories.map((repository, i) => [repository, counts[i] as number]),
    );
    const offsetMap = new Map<RepositoryId, number>(
      repositories.map((repository, i) => [repository, pageOffsets[i] as number]),
    );
    const weightMap = new Map<RepositoryId, number>(
      repositories.map((repository, i) => [repository, weights[i] as number]),
    );

    const contributing = repositories.filter((r) => behaviorMap.get(r) === "contributing");
    const failed = repositories.filter((r) => behaviorMap.get(r) === "failed");

    return {
      participating: repositories,
      behaviors: behaviorMap,
      contributing,
      failed,
      counts: countMap,
      offsets: offsetMap,
      weights: weightMap,
      k,
      limit,
      nextTieSequence,
    };
  });

// ─── Merge driver ────────────────────────────────────────────────────────────

/**
 * Build the `pages` map for a plan: contributing repositories get a page with a
 * non-null next offset, exhausted repositories get a page with a null next
 * offset, and failed repositories are omitted from the map entirely.
 */
function pagesFor(plan: PartialPlan): Map<RepositoryId, RepositoryPage> {
  const pages = new Map<RepositoryId, RepositoryPage>();
  for (const repository of plan.participating) {
    const behavior = plan.behaviors.get(repository);
    const count = plan.counts.get(repository) as number;
    if (behavior === "contributing") {
      pages.set(
        repository,
        contributingPage(repository, count, plan.offsets.get(repository) as number),
      );
    } else if (behavior === "exhausted") {
      pages.set(repository, exhaustedPage(repository, count));
    }
    // "failed" → no page is added, mirroring an absent/failed backend.
  }
  return pages;
}

/** Run `mergePages` for the plan and return the emitted next cursor. */
function mergeFor(plan: PartialPlan): CursorV2 | null {
  const cursor: CursorV2 = {
    v: 2,
    queryHash: "0123456789abcdef",
    offsets: [],
    participating: [...plan.participating].sort(),
    nextTieSequence: plan.nextTieSequence,
  };
  const fusion: FusionConfig = { k: plan.k, weights: plan.weights };
  const input: MergeInput = {
    pages: pagesFor(plan),
    participating: plan.participating,
    cursor,
    limit: plan.limit,
    fusion,
    queryHash: cursor.queryHash,
  };
  return mergePages(input).nextCursor;
}

// ─── Property 14: partial-result cursor omits failed repositories ─────────────

describe("Feature: n-repository-federation, Property 14: Partial-result cursor omits failed repositories", () => {
  test("emitted cursor records offsets only for contributing repositories and never for failed ones", () => {
    fc.assert(
      fc.property(partialPlanArb, (plan) => {
        const nextCursor = mergeFor(plan);

        // With ≥2 contributing repositories reporting a non-null next offset, the
        // merge always emits a next cursor (not the final page).
        expect(nextCursor).not.toBeNull();
        const emitted = nextCursor as CursorV2;

        const offsetKeys = emitted.offsets.map(([repository]) => repository);
        const contributing = new Set(plan.contributing);
        const failed = new Set(plan.failed);

        // Every emitted offset key is a contributing repository (Req 6.5): the
        // cursor carries offsets only for repositories that contributed a page
        // with more positions to fetch.
        for (const key of offsetKeys) {
          expect(contributing.has(key)).toBe(true);
        }

        // No failed repository appears in the offset map (Req 6.5, 6.6), so on
        // the next page it re-attempts from its last recorded offset or zero
        // rather than being fast-forwarded past positions it never examined.
        for (const repository of plan.failed) {
          expect(offsetKeys).not.toContain(repository);
        }

        // The offset keys are a subset of the contributing set and disjoint from
        // the failed set — stated directly for clarity.
        const keySet = new Set(offsetKeys);
        for (const key of keySet) {
          expect(failed.has(key)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
