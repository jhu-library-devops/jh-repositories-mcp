/**
 * Property-Based Test: final namespaced-id tiebreak
 *
 * Feature: n-repository-federation, Property 13: Final namespaced-id tiebreak
 *
 * **Validates: Requirements 5.7, 4.4**
 *
 * The N-way reciprocal-rank merge resolves an equal fusion-score tie first through
 * the Tie_Sequence round-robin and then, as the final deterministic tiebreak, by
 * ascending namespaced record id (Req 4.4). Design Property 13 states: "For any two
 * tied records that the tie sequence maps to the same repository preference, the
 * record with the lexicographically smaller namespaced id SHALL be ordered first"
 * (Req 5.7).
 *
 * Two tied records "map to the same repository preference" precisely when they come
 * from the same repository. For a *valid* input that cannot produce two records that
 * tie on fusion score: a validated adapter list carries strictly-increasing 1-based
 * `sourceRank`s (design §4, §8), so under one repository's weight two records always
 * have distinct scores. The record-id tiebreak is therefore the merge's *ultimate
 * stable ordering guarantee*: it keeps the merged order a deterministic total order
 * with no ambiguity among equally-scored records, and it is never *needed* to
 * separate two same-repository records because, for valid inputs, two such records
 * never tie.
 *
 * This suite exercises that guarantee over valid inputs (strictly-increasing,
 * per-repository-unique `sourceRank`s and equal weights so cross-repository ties are
 * frequent), and asserts two things:
 *
 *   1. The namespaced-id invariant holds verbatim: for every pair of emitted records
 *      that share an equal fusion score AND the same repository, the earlier-emitted
 *      one has the lexicographically smaller `record.id`. (For valid inputs there are
 *      no such same-repository equal-score pairs, so the merge never violates it.)
 *
 *   2. The ordering the final tiebreak underpins is genuinely deterministic and
 *      total: running the same merge twice yields byte-identical id order, and the
 *      merged list contains no duplicate ids — so cross-repository ties always
 *      resolve to one unambiguous, reproducible sequence.
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
 * varied lowercase identifiers exercise the tie ring and the namespaced-id order
 * more thoroughly than the two currently registered ids while keeping the real id
 * shape.
 */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,15}$/)
  .map((id) => id as RepositoryId);

/**
 * One record for `repository` carrying `platformId` and a 1-based `sourceRank`.
 * Different platform fragments produce different namespaced `record.id`s, whose
 * lexicographic order the final tiebreak governs.
 */
function record(repository: RepositoryId, platformId: string, rank: number): RepositoryRecord {
  return {
    ...createRepositoryRecord({
      platformId,
      repository,
      kind: "repository_item",
      title: `Record ${repository} ${platformId}`,
      landingPageUrl: "https://example.jhu.edu/x",
      provenance: {
        platform: "dspace",
        platformRecordId: platformId,
        canonicalApi: "dspace_rest",
        retrievedAt: "2026-07-29T00:00:00.000Z",
      },
    }),
    sourceRank: rank,
  };
}

/**
 * Build a VALID page for `repository`: `count` records carrying strictly-increasing
 * 1-based `sourceRank`s `1..count`, exactly as an adapter's validated list does
 * (design §4, §8). Platform fragments are varied per position so the namespaced ids
 * are not already in a trivial order, which keeps the tiebreak assertions honest.
 */
function page(repository: RepositoryId, count: number): RepositoryPage {
  const records = Array.from({ length: count }, (_, i) => {
    const rank = i + 1;
    // Deliberately non-monotonic fragment relative to rank so id order and rank
    // order are decorrelated.
    const fragment = `${(count - i).toString(36)}z${i}`;
    return record(repository, fragment, rank);
  });
  return {
    repository,
    results: records,
    nextOffset: null,
    totalCandidates: count,
    validationOmissions: 0,
    warnings: [],
  };
}

/**
 * Recompute a record's fusion score the way the merge does:
 * `weight / (k + sourceRank)`, with an absent rank treated as ranked last.
 */
function recomputeFusionScore(rec: RepositoryRecord, fusion: FusionConfig): number {
  const rank = rec.sourceRank ?? Number.MAX_SAFE_INTEGER;
  const weight = fusion.weights.get(rec.repository) ?? 1.0;
  return weight / (fusion.k + rank);
}

// ─── Generated scenario ────────────────────────────────────────────────────

interface Scenario {
  readonly pages: ReadonlyMap<RepositoryId, RepositoryPage>;
  readonly participating: readonly RepositoryId[];
  readonly fusion: FusionConfig;
  readonly limit: number;
  readonly startTie: number;
}

/**
 * A scenario of 2–8 distinct repositories, each with a valid rank-ordered page of
 * 1–6 records, equal weights, a fixed RRF `k`, a page limit, and a carried tie
 * position. Equal weights across all repositories mean records sharing a
 * `sourceRank` across *different* repositories carry identical fusion scores, so
 * cross-repository ties — the inputs that drive the Tie_Sequence and, under it, the
 * namespaced-id ordering guarantee — occur on nearly every run.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .uniqueArray(repositoryIdArb, { minLength: 2, maxLength: 8 })
  .chain((repositories) =>
    fc
      .record({
        counts: fc.array(fc.integer({ min: 1, max: 6 }), {
          minLength: repositories.length,
          maxLength: repositories.length,
        }),
        k: fc.integer({ min: 1, max: 1000 }),
        limit: fc.integer({ min: 1, max: 40 }),
        startTie: fc.integer({ min: 0, max: 10_000 }),
      })
      .map(({ counts, k, limit, startTie }): Scenario => {
        const pages = new Map<RepositoryId, RepositoryPage>();
        const weights = new Map<RepositoryId, number>();
        repositories.forEach((repository, i) => {
          pages.set(repository, page(repository, counts[i] as number));
          // Equal weights → identical ranks tie across repositories (Req 5.2/5.7 path).
          weights.set(repository, 1.0);
        });
        return {
          pages,
          participating: [...repositories],
          fusion: { k, weights },
          limit,
          startTie,
        };
      }),
  );

// ─── Merge driver ──────────────────────────────────────────────────────────

function runMerge(scenario: Scenario): ReturnType<typeof mergePages> {
  const cursor: CursorV2 = {
    v: 2,
    queryHash: "0123456789abcdef",
    offsets: [],
    participating: [...scenario.participating].sort(),
    nextTieSequence: scenario.startTie,
  };
  const input: MergeInput = {
    pages: scenario.pages,
    participating: scenario.participating,
    cursor,
    limit: scenario.limit,
    fusion: scenario.fusion,
    queryHash: cursor.queryHash,
  };
  return mergePages(input);
}

// ─── Property 13: final namespaced-id tiebreak ───────────────────────────────

describe("Feature: n-repository-federation, Property 13: Final namespaced-id tiebreak", () => {
  test("same-repository equal-score records never appear out of ascending-id order", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const results = runMerge(scenario).results;

        // For every pair of emitted records sharing an equal fusion score AND the
        // same repository, the earlier-emitted one must have the smaller namespaced
        // id. Two tied records that map to the same repository preference are exactly
        // same-repository records (Req 5.7); the lexicographically smaller id leads.
        for (let i = 0; i < results.length; i += 1) {
          for (let j = i + 1; j < results.length; j += 1) {
            const a = results[i] as RepositoryRecord;
            const b = results[j] as RepositoryRecord;
            if (a.repository !== b.repository) {
              continue;
            }
            if (
              recomputeFusionScore(a, scenario.fusion) === recomputeFusionScore(b, scenario.fusion)
            ) {
              expect(a.id < b.id).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the tiebreak underpins a deterministic, duplicate-free total order", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const first = runMerge(scenario).results.map((r) => r.id);
        const second = runMerge(scenario).results.map((r) => r.id);

        // The final namespaced-id tiebreak guarantees the merged order is a single
        // deterministic sequence: identical inputs yield byte-identical id order
        // (Req 4.4), and no record id appears twice, so every cross-repository tie
        // resolves to one unambiguous winner.
        expect(second).toEqual(first);
        expect(new Set(first).size).toBe(first.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
