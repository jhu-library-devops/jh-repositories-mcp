/**
 * Property-Based Tests: Facet Count Conservation (N-Way Facet Merging)
 *
 * Feature: n-repository-federation, Property 17: Facet count conservation
 *
 * **Validates: Requirements 7.2**
 *
 * `mergeFacets` sums the counts of values that normalize to the same label and
 * reports a per-repository breakdown alongside the merged total (Req 7.2). That
 * breakdown must account for every candidate counted into the merged total and
 * must name only repositories that actually participated in the request.
 *
 * These properties assert, across randomized per-repository facet contributions
 * (1–8 repos, varied labels, counts, and supported-facet sets), that for every
 * merged `FacetValue` in every returned `FacetResult` (including the synthetic
 * `repository` facet):
 *   - `value.count` equals the sum of its `repositoryBreakdown` values; and
 *   - every key in `repositoryBreakdown` is the id of a participating
 *     repository (one present in the generated contributions).
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  type RepositoryFacetContribution,
  isFacetMergeError,
  mergeFacets,
} from "../../src/federation/facet-merge";
import type { CommonFacet, FacetResult, FacetValue, RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

/** The content facets a repository may support (the synthetic `repository` facet is excluded). */
const CONTENT_FACETS: readonly CommonFacet[] = [
  "creator",
  "subject",
  "year",
  "resourceType",
  "collection",
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A lowercase repository id built from the base64url-safe alphabet [a-z0-9]. */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .string({
    minLength: 2,
    maxLength: 8,
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
  })
  .filter((value) => value.length >= 2) as fc.Arbitrary<RepositoryId>;

/**
 * A facet label drawn from a small pool so distinct repositories frequently
 * contribute values that normalize to the same canonical label — exercising the
 * merge-and-sum path rather than only disjoint singletons.
 */
const labelArb: fc.Arbitrary<string> = fc.constantFrom(
  "Machine Learning",
  "machine-learning",
  "Machine  Learning.",
  "Open Access",
  "open access",
  "Ph.D.",
  "Climate (Science)",
  "Data Science",
  "History",
  "2021",
  "2022",
);

/** A single facet value with a positive integer count and a pooled label. */
const facetValueArb: fc.Arbitrary<FacetValue> = fc.record({
  label: labelArb,
  count: fc.integer({ min: 1, max: 100_000 }),
});

/** A facet result for a supported content facet, with 0–6 values. */
function facetResultArb(facet: CommonFacet): fc.Arbitrary<FacetResult> {
  return fc
    .array(facetValueArb, { minLength: 0, maxLength: 6 })
    .map((values) => ({ facet, values }));
}

/**
 * One repository's contribution: a repository id, a supported-facet subset, the
 * facet results it returned for those supported facets, and a Solr candidate
 * total for the synthetic `repository` facet.
 */
const contributionArb: fc.Arbitrary<RepositoryFacetContribution> = fc
  .record({
    repository: repositoryIdArb,
    supported: fc
      .subarray([...CONTENT_FACETS], { minLength: 0, maxLength: CONTENT_FACETS.length })
      .map((facets) => new Set<CommonFacet>(facets)),
    totalMatches: fc.integer({ min: 0, max: 1_000_000 }),
  })
  .chain(({ repository, supported, totalMatches }) =>
    fc.tuple(...[...supported].map((facet) => facetResultArb(facet))).map((facets) => ({
      repository,
      supported,
      totalMatches,
      facets: facets as FacetResult[],
    })),
  );

/**
 * A set of 1–8 contributions with distinct repository ids, so the participating
 * set is well defined and no two contributions collide on repository id.
 */
const contributionsArb: fc.Arbitrary<readonly RepositoryFacetContribution[]> = fc
  .uniqueArray(contributionArb, {
    minLength: 1,
    maxLength: 8,
    selector: (contribution) => contribution.repository,
  })
  .map((contributions) => contributions);

/** The set of repository ids that participated in a contributions list. */
function participatingIds(
  contributions: readonly RepositoryFacetContribution[],
): ReadonlySet<RepositoryId> {
  return new Set(contributions.map((contribution) => contribution.repository));
}

/** Sum the per-repository breakdown of a merged facet value. */
function sumBreakdown(value: FacetValue): number {
  const breakdown = value.repositoryBreakdown ?? {};
  return Object.values(breakdown).reduce((sum, count) => sum + (count ?? 0), 0);
}

// ─── Property 17: facet count conservation ───────────────────────────────────

describe("Property 17: facet count conservation", () => {
  test("every merged value's count equals the sum of its per-repository breakdown", () => {
    fc.assert(
      fc.property(contributionsArb, (contributions) => {
        const result = mergeFacets(contributions);
        if (isFacetMergeError(result)) {
          return; // No participating adapter had data; nothing to conserve.
        }
        for (const facet of result) {
          for (const value of facet.values) {
            expect(sumBreakdown(value)).toBe(value.count);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("every breakdown key is a participating repository id", () => {
    fc.assert(
      fc.property(contributionsArb, (contributions) => {
        const result = mergeFacets(contributions);
        if (isFacetMergeError(result)) {
          return;
        }
        const participating = participatingIds(contributions);
        for (const facet of result) {
          for (const value of facet.values) {
            const breakdown = value.repositoryBreakdown ?? {};
            for (const repository of Object.keys(breakdown) as RepositoryId[]) {
              expect(participating.has(repository)).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("every merged value carries a non-empty breakdown", () => {
    fc.assert(
      fc.property(contributionsArb, (contributions) => {
        const result = mergeFacets(contributions);
        if (isFacetMergeError(result)) {
          return;
        }
        for (const facet of result) {
          for (const value of facet.values) {
            const breakdown = value.repositoryBreakdown ?? {};
            expect(Object.keys(breakdown).length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
