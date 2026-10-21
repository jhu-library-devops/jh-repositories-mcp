/**
 * Property-Based Test: Every result carries source attribution
 *
 * Feature: n-repository-federation, Property 10: Every result carries source attribution
 *
 * **Validates: Requirements 4.6**
 *
 * The N-way reciprocal-rank merge stamps every emitted record with its source
 * attribution: the `repository` it came from and the 1-based `sourceRank` it held
 * in that repository's own validated ordering (Req 4.6). This holds on both merge
 * paths — the fusion path that interleaves two or more responders, and the
 * single-responder passthrough path that preserves one adapter's native ordering.
 *
 * This test generates multi-repository pages (1–8 participating repositories, each
 * with a rank-ordered page whose records carry 1-based `sourceRank`s), runs
 * `mergePages`, and asserts every record in the merged results carries a defined,
 * non-null `repository` that is one of the participating ids, together with a
 * defined, non-null `sourceRank`.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { FusionConfig, MergeInput } from "../../src/federation/merge";
import { mergePages } from "../../src/federation/merge";
import { createRepositoryRecord } from "../../src/models/index";
import type { RepositoryId, RepositoryPage, RepositoryRecord } from "../../src/models/index";

const NUM_RUNS = 200;

// ─── Builders ────────────────────────────────────────────────────────────────

/**
 * A repository id. The merge treats ids as opaque lexicographic sort keys, so
 * varied lowercase identifiers exercise attribution across more repositories than
 * the two currently registered ids while keeping the real id shape.
 */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,15}$/)
  .map((id) => id as RepositoryId);

/** 1–8 distinct participating repository ids (allows the single-responder path). */
const participatingArb: fc.Arbitrary<readonly RepositoryId[]> = fc.uniqueArray(repositoryIdArb, {
  minLength: 1,
  maxLength: 8,
});

/** A single rank-ordered record carrying a 1-based `sourceRank`. */
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

/**
 * Build a page for `repository` whose `count` results carry 1-based `sourceRank`s
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

// ─── Generated scenario ──────────────────────────────────────────────────────

interface Scenario {
  readonly pages: ReadonlyMap<RepositoryId, RepositoryPage>;
  readonly participating: readonly RepositoryId[];
  readonly fusion: FusionConfig;
  readonly limit: number;
}

/**
 * A merge scenario: 1–8 participating repositories, each with a rank-ordered page
 * of 0–6 records, per-repository weights in the valid configured range, and a page
 * limit. Pages may be empty, so the generator covers the single-responder and
 * no-responder cases alongside the fusion path.
 */
const scenarioArb: fc.Arbitrary<Scenario> = participatingArb.chain((participating) =>
  fc
    .tuple(
      fc.array(fc.integer({ min: 0, max: 6 }), {
        minLength: participating.length,
        maxLength: participating.length,
      }),
      fc.array(fc.integer({ min: 1, max: 10_000 }), {
        minLength: participating.length,
        maxLength: participating.length,
      }),
      fc.integer({ min: 1, max: 50 }),
    )
    .map(([counts, weightHundredths, limit]): Scenario => {
      const pages = new Map<RepositoryId, RepositoryPage>();
      const weights = new Map<RepositoryId, number>();
      participating.forEach((repository, i) => {
        pages.set(repository, page(repository, counts[i] ?? 0));
        weights.set(repository, (weightHundredths[i] ?? 100) / 100);
      });
      return { pages, participating, fusion: { k: 60, weights }, limit };
    }),
);

// ─── Property 10: every result carries source attribution ────────────────────

describe("Feature: n-repository-federation, Property 10: Every result carries source attribution", () => {
  test("every merged record carries a participating repository and a 1-based sourceRank", () => {
    fc.assert(
      fc.property(scenarioArb, ({ pages, participating, fusion, limit }) => {
        const participatingSet = new Set<RepositoryId>(participating);
        const input: MergeInput = {
          pages,
          participating,
          cursor: null,
          limit,
          fusion,
          queryHash: "00000000000000aa",
        };

        const merged = mergePages(input);

        expect(merged.results.length).toBeLessThanOrEqual(limit);

        for (const result of merged.results) {
          // Source attribution: a defined, non-null repository that is one of the
          // participating ids (Req 4.6).
          expect(result.repository).toBeDefined();
          expect(result.repository).not.toBeNull();
          expect(participatingSet.has(result.repository)).toBe(true);

          // Source attribution: a defined, non-null 1-based rank (Req 4.6).
          expect(result.sourceRank).toBeDefined();
          expect(result.sourceRank).not.toBeNull();
          expect(typeof result.sourceRank).toBe("number");
          expect(result.sourceRank as number).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
