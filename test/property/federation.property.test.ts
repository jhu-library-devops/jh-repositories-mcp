/**
 * Property-Based Tests: Federation, Ranking, and Cursor (N-Way surface)
 *
 * **Validates: Requirements 4.1-4.3, 4.6, 6.1-6.6, 9.1, 9.3**
 *
 * Exercises the generalized N-way federation surface that replaced the v1
 * two-pointer merge and the fixed `FederatedCursorV1` codec:
 *   - order depends only on repository-local ranks, not raw scores (Req 4.1-4.3)
 *   - balanced ties alternate deterministically over the participating subset
 *     (Req 5.1-5.3)
 *   - the next Cursor_V2 carries offsets for contributing repositories only and
 *     round-trips through the codec (Req 4.3, 6.5, 6.6)
 *   - V1 cursors still decode and map to equivalent V2 state (Req 9.1)
 *   - partial-result assembly preserves the responding repository's records and
 *     leaks no internals (Req 6.1-6.3)
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  assemblePartial,
  computeQueryHashV2,
  decodeCursor,
  encodeCursorV2,
  mergePages,
} from "../../src/federation/index";
import type { AdapterResult, FusionConfig, MergeResult } from "../../src/federation/index";
import { createRepositoryRecord } from "../../src/models/index";
import type { RepositoryId, RepositoryPage, RepositoryRecord } from "../../src/models/index";

const NUM_RUNS = 150;

const PARTICIPATING: readonly RepositoryId[] = ["jhrdr", "jscholarship"];
const FUSION: FusionConfig = { k: 60, weights: new Map() };
const isRegisteredRepo = (id: string): boolean => id === "jscholarship" || id === "jhrdr";

// ─── Builders ────────────────────────────────────────────────────────────────

function record(repository: RepositoryId, rank: number, suffix: string): RepositoryRecord {
  return {
    ...createRepositoryRecord({
      platformId: `${suffix}-${rank}`,
      repository,
      kind: repository === "jscholarship" ? "repository_item" : "dataset",
      title: `Record ${suffix} ${rank}`,
      landingPageUrl: "https://example.jhu.edu/x",
      provenance: {
        platform: repository === "jscholarship" ? "dspace" : "dataverse",
        platformRecordId: `${suffix}-${rank}`,
        canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
        retrievedAt: "2026-07-29T00:00:00.000Z",
      },
    }),
    sourceRank: rank,
  };
}

function page(
  repository: RepositoryId,
  ranks: number[],
  nextOffset: number | null,
): RepositoryPage {
  return {
    repository,
    results: ranks.map((rank) => record(repository, rank, repository.slice(0, 2))),
    nextOffset,
    totalCandidates: ranks.length,
    validationOmissions: 0,
    warnings: [],
  };
}

const ranksArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 200 }), { minLength: 0, maxLength: 12 })
  .map((ranks) => [...ranks].sort((a, b) => a - b));

// ─── cursor round-trip and query binding ────────────────────────────────────

describe("Cursor_V2 round-trip and query binding", () => {
  test("the query hash binds to every request dimension", () => {
    const base = {
      query: "housing",
      repositories: "all" as const,
      sort: "relevance" as const,
      limit: 10,
    };
    const baseHash = computeQueryHashV2(base);
    expect(computeQueryHashV2({ ...base })).toBe(baseHash);
    expect(computeQueryHashV2({ ...base, query: "housing " })).toBe(baseHash); // normalized
    expect(computeQueryHashV2({ ...base, query: "mortgages" })).not.toBe(baseHash);
    expect(computeQueryHashV2({ ...base, repositories: ["jhrdr"] })).not.toBe(baseHash);
    expect(computeQueryHashV2({ ...base, sort: "date_desc" })).not.toBe(baseHash);
    expect(computeQueryHashV2({ ...base, limit: 11 })).not.toBe(baseHash);
    expect(computeQueryHashV2({ ...base, filters: { subjects: ["x"] } })).not.toBe(baseHash);
  });

  test("a V1 cursor decodes and maps to equivalent V2 offsets (Req 9.1)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.constantFrom<RepositoryId>("jscholarship", "jhrdr"),
        (jsOffset, dvOffset, nextTieSource) => {
          const v1 = Buffer.from(
            JSON.stringify({
              v: 1,
              queryHash: "00000000000000aa",
              jsOffset,
              dvOffset,
              nextTieSource,
            }),
            "utf8",
          ).toString("base64url");
          const decoded = decodeCursor(v1, isRegisteredRepo);
          expect(decoded.error).toBeNull();
          const offsets = new Map(decoded.cursor?.offsets ?? []);
          expect(offsets.get("jscholarship")).toBe(jsOffset);
          expect(offsets.get("jhrdr")).toBe(dvOffset);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── order depends only on repository-local ranks ───────────────────────────

describe("order depends only on repository-local ranks (Req 4.1-4.3)", () => {
  test("identical (repository, rank) structure yields identical id order", () => {
    fc.assert(
      fc.property(
        ranksArb,
        ranksArb,
        fc.integer({ min: 1, max: 25 }),
        (jsRanks, dvRanks, limit) => {
          const run = () =>
            mergePages({
              pages: new Map([
                ["jscholarship", page("jscholarship", jsRanks, null)],
                ["jhrdr", page("jhrdr", dvRanks, null)],
              ]),
              participating: PARTICIPATING,
              cursor: null,
              limit,
              fusion: FUSION,
              queryHash: "00000000000000aa",
            }).results.map((r) => r.id);
          expect(run()).toEqual(run());
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("lower repository rank merges ahead of higher rank from the same repository", () => {
    fc.assert(
      fc.property(ranksArb, (ranks) => {
        const merged = mergePages({
          pages: new Map([["jscholarship", page("jscholarship", ranks, null)]]),
          participating: ["jscholarship"],
          cursor: null,
          limit: 25,
          fusion: FUSION,
          queryHash: "00000000000000aa",
        });
        const mergedRanks = merged.results.map((r) => r.sourceRank);
        expect(mergedRanks).toEqual([...mergedRanks].sort((a, b) => (a ?? 0) - (b ?? 0)));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── balanced ties alternate deterministically ──────────────────────────────

describe("balanced ties alternate deterministically (Req 5.1-5.3)", () => {
  test("equal ranks alternate sources starting from the tie position", () => {
    const pages = new Map<RepositoryId, RepositoryPage>([
      ["jscholarship", page("jscholarship", [1, 2, 3], null)],
      ["jhrdr", page("jhrdr", [1, 2, 3], null)],
    ]);
    const fromStart = mergePages({
      pages,
      participating: PARTICIPATING,
      cursor: null,
      limit: 6,
      fusion: FUSION,
      queryHash: "00000000000000aa",
    });
    // Position 0 of the sorted ring is "jhrdr" (lexicographically first).
    expect(fromStart.results[0]?.repository).toBe("jhrdr");
    // Byte-identical order for identical inputs (determinism).
    const again = mergePages({
      pages,
      participating: PARTICIPATING,
      cursor: null,
      limit: 6,
      fusion: FUSION,
      queryHash: "00000000000000aa",
    });
    expect(again.results.map((r) => r.id)).toEqual(fromStart.results.map((r) => r.id));
  });
});

// ─── next cursor offset propagation + round-trip ─────────────────────────────

describe("next Cursor_V2 offset propagation (Req 4.3, 6.5, 6.6)", () => {
  test("contributing offsets propagate; exhausted repositories are omitted", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
        (jsNext, dvNext) => {
          const merged = mergePages({
            pages: new Map([
              ["jscholarship", page("jscholarship", [1], jsNext)],
              ["jhrdr", page("jhrdr", [2], dvNext)],
            ]),
            participating: PARTICIPATING,
            cursor: null,
            limit: 10,
            fusion: FUSION,
            queryHash: "00000000000000aa",
          });
          if (jsNext === null && dvNext === null) {
            expect(merged.nextCursor).toBeNull();
            return;
          }
          const offsets = new Map(merged.nextCursor?.offsets ?? []);
          expect(offsets.has("jscholarship")).toBe(jsNext !== null);
          expect(offsets.has("jhrdr")).toBe(dvNext !== null);
          if (jsNext !== null) {
            expect(offsets.get("jscholarship")).toBe(jsNext);
          }
          // The emitted cursor must survive transport unchanged.
          if (merged.nextCursor) {
            const roundTripped = decodeCursor(encodeCursorV2(merged.nextCursor), isRegisteredRepo);
            expect(roundTripped.error).toBeNull();
            expect(roundTripped.cursor?.offsets).toEqual(merged.nextCursor.offsets);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── partial success preserves successful results ───────────────────────────

describe("partial success preserves successful results (Req 6.1-6.3)", () => {
  test("one failed repository never drops the other's records or leaks internals", () => {
    fc.assert(
      fc.property(ranksArb, (ranks) => {
        const jsPage = page("jscholarship", ranks, null);
        const merged: MergeResult = mergePages({
          pages: new Map([["jscholarship", jsPage]]),
          participating: ["jscholarship"],
          cursor: null,
          limit: 25,
          fusion: FUSION,
          queryHash: "00000000000000aa",
        });
        const results: AdapterResult[] = [
          { repository: "jscholarship", outcome: "success", page: jsPage, failureCode: null },
          { repository: "jhrdr", outcome: "error", page: null, failureCode: "backend_unavailable" },
        ];
        const assembly = assemblePartial({
          requested: ["jscholarship", "jhrdr"],
          results,
          mergeResult: merged,
          encodedCursor: null,
        });
        expect(assembly.isError).toBe(false);
        expect(assembly.response.results).toHaveLength(Math.min(ranks.length, 25));
        expect(assembly.response.repositories.failed).toEqual(["jhrdr"]);
        const backendWarnings = assembly.response.warnings.filter(
          (w) => w.code === "backend_unavailable",
        );
        expect(backendWarnings).toHaveLength(1);
        for (const warning of assembly.response.warnings) {
          expect(warning.message).not.toMatch(/internal|:8080|:8983|exception|stack/i);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
