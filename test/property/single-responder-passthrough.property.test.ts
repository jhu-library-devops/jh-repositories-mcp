/**
 * Property-Based Tests: single-responder passthrough preserves native ordering
 *
 * Feature: n-repository-federation, Property 9: Single-responder passthrough
 *
 * **Validates: Requirements 4.7, 4.8**
 *
 * When there is nothing to fuse across — either exactly one repository is
 * selected (Req 4.7), or multiple repositories are selected but only one returns
 * results (Req 4.8) — the merge takes the passthrough path: it preserves the lone
 * responding adapter's own validated ordering verbatim, truncated to `limit`, with
 * no reciprocal-rank re-ranking applied. The emitted result ids (and their order)
 * must therefore exactly equal that adapter's native result order.
 *
 * For the multi-selected-but-one-responder case the merge must additionally warn
 * the client about every selected repository that returned nothing, emitting a
 * `backend_unavailable` warning that names each unavailable repository (Req 4.8).
 *
 * This suite generates both cases and asserts, over ≥100 runs:
 *   1. the merged ids equal the responder's native ids truncated to `limit`;
 *   2. no reordering occurs (ordering is identical, not merely set-equal);
 *   3. for the multi-selected case, a `backend_unavailable` warning names each
 *      unavailable repository.
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
 * varied lowercase identifiers exercise the passthrough and warning paths more
 * thoroughly than the two currently registered ids while keeping the real shape.
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

/** An empty page for a selected repository that returned no results. */
function emptyPage(repository: RepositoryId): RepositoryPage {
  return {
    repository,
    results: [],
    nextOffset: null,
    totalCandidates: 0,
    validationOmissions: 0,
    warnings: [],
  };
}

// ─── Merge driver ──────────────────────────────────────────────────────────

/** Run the merge for the given pages and participating set, returning the result. */
function runMerge(
  entries: ReadonlyArray<readonly [RepositoryId, RepositoryPage]>,
  participating: readonly RepositoryId[],
  limit: number,
  k: number,
): ReturnType<typeof mergePages> {
  const cursor: CursorV2 = {
    v: 2,
    queryHash: "0123456789abcdef",
    offsets: [],
    participating: [...participating].sort(),
    nextTieSequence: 0,
  };
  const fusion: FusionConfig = { k, weights: new Map() };
  const input: MergeInput = {
    pages: new Map(entries),
    participating,
    cursor,
    limit,
    fusion,
    queryHash: cursor.queryHash,
  };
  return mergePages(input);
}

/** The native ids of a page's results, truncated to `limit`. */
function nativeIds(responderPage: RepositoryPage, limit: number): string[] {
  return responderPage.results.slice(0, limit).map((result) => result.id);
}

// ─── Property 9 (case 1): exactly one repository selected (Req 4.7) ───────────

describe("Feature: n-repository-federation, Property 9: Single-responder passthrough", () => {
  test("a single selected repository passes through its native ordering unchanged (Req 4.7)", () => {
    fc.assert(
      fc.property(
        fc.record({
          repository: repositoryIdArb,
          count: fc.integer({ min: 1, max: 8 }),
          limit: fc.integer({ min: 1, max: 12 }),
          k: fc.integer({ min: 1, max: 1000 }),
        }),
        ({ repository, count, limit, k }) => {
          const responderPage = page(repository, count);
          const result = runMerge([[repository, responderPage]], [repository], limit, k);

          // Merged ids equal the responder's native ordering, truncated to limit.
          expect(result.results.map((r) => r.id)).toEqual(nativeIds(responderPage, limit));
          // No fusion re-ranking: sourceRanks stay strictly ascending as supplied.
          const ranks = result.results.map((r) => r.sourceRank);
          expect(ranks).toEqual([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)));
          // A lone selected repository emits no unavailability warning.
          expect(result.warnings).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Property 9 (case 2): multiple selected, one responder (Req 4.8) ────────

  test("multiple selected repositories with one responder pass through and warn (Req 4.8)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(repositoryIdArb, { minLength: 2, maxLength: 8 }).chain((repositories) =>
          fc.record({
            repositories: fc.constant(repositories),
            // Which of the selected repositories is the sole responder.
            responderIndex: fc.integer({ min: 0, max: repositories.length - 1 }),
            count: fc.integer({ min: 1, max: 8 }),
            limit: fc.integer({ min: 1, max: 12 }),
            k: fc.integer({ min: 1, max: 1000 }),
            // For each non-responder decide whether it is present (empty page)
            // or entirely absent from the pages map.
            presence: fc.array(fc.boolean(), {
              minLength: repositories.length,
              maxLength: repositories.length,
            }),
          }),
        ),
        ({ repositories, responderIndex, count, limit, k, presence }) => {
          const responder = repositories[responderIndex] as RepositoryId;
          const responderPage = page(responder, count);

          const entries: Array<readonly [RepositoryId, RepositoryPage]> = [];
          for (let i = 0; i < repositories.length; i++) {
            const repository = repositories[i] as RepositoryId;
            if (repository === responder) {
              entries.push([repository, responderPage]);
            } else if (presence[i]) {
              // Present but empty: selected, returned nothing.
              entries.push([repository, emptyPage(repository)]);
            }
            // else: absent from the pages map entirely.
          }

          const result = runMerge(entries, repositories, limit, k);

          // Merged ids equal the sole responder's native ordering, truncated.
          expect(result.results.map((r) => r.id)).toEqual(nativeIds(responderPage, limit));
          // Every emitted record is attributed to the responder.
          for (const emitted of result.results) {
            expect(emitted.repository).toBe(responder);
          }

          // A backend_unavailable warning names each unavailable selected repository.
          const unavailable = repositories.filter((r) => r !== responder);
          const warned = new Set(
            result.warnings
              .filter((w) => w.code === "backend_unavailable")
              .map((w) => w.repository),
          );
          for (const repository of unavailable) {
            expect(warned.has(repository)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
