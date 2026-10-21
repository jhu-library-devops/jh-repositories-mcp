/**
 * Property-Based Test: Fusion score ordering
 *
 * Feature: n-repository-federation, Property 8: Fusion score ordering
 *
 * **Validates: Requirements 4.2, 4.3**
 *
 * The N-way reciprocal-rank merge orders records by a cross-repository fusion key
 * derived purely from rank and configured weight:
 *
 *   fusionScore = weight / (k + sourceRank)        (Req 4.2)
 *
 * At each step the merge appends the greatest-score head, so the emitted sequence
 * is non-increasing in fusion score (Req 4.3). Equal adjacent scores are allowed:
 * those are the cases resolved by the Tie_Sequence and, finally, the namespaced
 * record id, which pick a deterministic winner among equally-scored heads without
 * disturbing the monotonic ordering.
 *
 * This test generates multi-repository pages (2–8 repositories, with more than one
 * responder so the single-responder passthrough path does not apply), runs
 * `mergePages`, independently recomputes each emitted record's fusion score from
 * its stamped repository and `sourceRank`, and asserts every record's score is ≥
 * the next record's.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { FusionConfig } from "../../src/federation/merge";
import { mergePages } from "../../src/federation/merge";
import { createRepositoryRecord } from "../../src/models/index";
import type { RepositoryId, RepositoryPage, RepositoryRecord } from "../../src/models/index";

const NUM_RUNS = 200;

// ─── Builders ────────────────────────────────────────────────────────────────

/**
 * A repository id. The merge treats ids as opaque lexicographic sort keys for the
 * final namespaced-id tiebreak, so varied lowercase identifiers exercise ordering
 * more thoroughly than the two currently registered ids while staying in shape.
 */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,15}$/)
  .map((id) => id as RepositoryId);

/** 2–8 distinct participating repository ids (the configured max adapter count). */
const participatingArb: fc.Arbitrary<readonly RepositoryId[]> = fc.uniqueArray(repositoryIdArb, {
  minLength: 2,
  maxLength: 8,
});

/** A strictly increasing list of 0–10 1-based source ranks for one repository. */
const ranksArb: fc.Arbitrary<readonly number[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 100 }), { minLength: 0, maxLength: 10 })
  .map((ranks) => [...ranks].sort((a, b) => a - b));

/** A fusion weight in the valid configured range (0.01–100.0). */
const weightArb: fc.Arbitrary<number> = fc
  .integer({ min: 1, max: 10_000 })
  .map((hundredths) => hundredths / 100);

function record(repository: RepositoryId, rank: number): RepositoryRecord {
  const platform = rank % 2 === 0 ? "dspace" : "dataverse";
  return {
    ...createRepositoryRecord({
      platformId: `${repository}-${rank}`,
      repository,
      kind: platform === "dspace" ? "repository_item" : "dataset",
      title: `Record ${repository} ${rank}`,
      landingPageUrl: "https://example.jhu.edu/x",
      provenance: {
        platform,
        platformRecordId: `${repository}-${rank}`,
        canonicalApi: platform === "dspace" ? "dspace_rest" : "dataverse_native_api",
        retrievedAt: "2026-07-29T00:00:00.000Z",
      },
    }),
    sourceRank: rank,
  };
}

function page(repository: RepositoryId, ranks: readonly number[]): RepositoryPage {
  return {
    repository,
    results: ranks.map((rank) => record(repository, rank)),
    nextOffset: null,
    totalCandidates: ranks.length,
    validationOmissions: 0,
    warnings: [],
  };
}

/**
 * Recompute a record's fusion score the same way the merge does:
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
}

/**
 * Build a scenario of 2–8 repositories where at least two of them return results,
 * so the merge takes the fusion path rather than single-responder passthrough.
 */
const scenarioArb: fc.Arbitrary<Scenario> = participatingArb.chain((participating) =>
  fc
    .tuple(
      fc.array(ranksArb, { minLength: participating.length, maxLength: participating.length }),
      fc.array(weightArb, { minLength: participating.length, maxLength: participating.length }),
      fc.integer({ min: 1, max: 50 }),
    )
    .map(([perRepoRanks, perRepoWeights, limit]): Scenario => {
      // Force at least two responders so passthrough does not apply: if fewer than
      // two repositories drew a non-empty rank list, seed the first two with ranks.
      const ranks = perRepoRanks.map((r, i) => (r.length === 0 && i < 2 ? [i + 1] : r));
      const responders = ranks.filter((r) => r.length > 0).length;
      if (responders < 2) {
        ranks[0] = [1];
        ranks[1] = [1];
      }

      const pages = new Map<RepositoryId, RepositoryPage>();
      const weights = new Map<RepositoryId, number>();
      participating.forEach((repository, i) => {
        pages.set(repository, page(repository, ranks[i] ?? []));
        weights.set(repository, perRepoWeights[i] ?? 1.0);
      });

      return {
        pages,
        participating,
        fusion: { k: 60, weights },
        limit,
      };
    }),
);

// ─── Property 8: fusion score ordering ───────────────────────────────────────

describe("Feature: n-repository-federation, Property 8: Fusion score ordering", () => {
  test("each emitted record's fusion score is ≥ the next record's", () => {
    fc.assert(
      fc.property(scenarioArb, ({ pages, participating, fusion, limit }) => {
        const merged = mergePages({
          pages,
          participating,
          cursor: null,
          limit,
          fusion,
          queryHash: "00000000000000aa",
        });

        const scores = merged.results.map((rec) => recomputeFusionScore(rec, fusion));
        for (let i = 1; i < scores.length; i += 1) {
          // Non-increasing: equal adjacent scores are the tie-resolved cases.
          expect((scores[i - 1] as number) >= (scores[i] as number)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("varied RRF constant k preserves the non-increasing ordering", () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 1, max: 1000 }), (scenario, k) => {
        const fusion: FusionConfig = { k, weights: scenario.fusion.weights };
        const merged = mergePages({
          pages: scenario.pages,
          participating: scenario.participating,
          cursor: null,
          limit: scenario.limit,
          fusion,
          queryHash: "00000000000000bb",
        });

        const scores = merged.results.map((rec) => recomputeFusionScore(rec, fusion));
        for (let i = 1; i < scores.length; i += 1) {
          expect((scores[i - 1] as number) >= (scores[i] as number)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
