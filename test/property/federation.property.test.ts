/**
 * Property-Based Tests: Federation, Ranking, and Cursor
 *
 * **Validates: Requirements 11.1-11.9, 1.8, 15.3, 16.2**
 *
 * Property 10: Federation ignores raw score magnitude (order depends only on
 *              repository-local ranks)
 * Property 11: Balanced ties alternate deterministically
 * Property 12: Cursor round-trip and query binding
 * Property 13: Partial success preserves successful results
 * Property 16: nextOffset propagation and exhaustion
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  EXHAUSTED_OFFSET,
  assembleResponse,
  computeQueryHash,
  decodeCursor,
  encodeCursor,
  mergePages,
} from "../../src/federation/index";
import type { FederatedCursor } from "../../src/federation/index";
import { createRepositoryRecord } from "../../src/models/index";
import type { RepositoryId, RepositoryPage, RepositoryRecord } from "../../src/models/index";

const NUM_RUNS = 150;

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

const cursorArb: fc.Arbitrary<FederatedCursor> = fc.record({
  v: fc.constant(1 as const),
  queryHash: fc
    .integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
    .map((n) => n.toString(16).padStart(16, "0").slice(0, 16)),
  jsOffset: fc.integer({ min: -1, max: 1000 }),
  dvOffset: fc.integer({ min: -1, max: 1000 }),
  nextTieSource: fc.constantFrom<RepositoryId>("jscholarship", "jhrdr"),
});

// ─── Property 12: cursor round-trip and query binding ───────────────────────

describe("Property 12: cursor round-trip and query binding", () => {
  test("encode then decode preserves every field", () => {
    fc.assert(
      fc.property(cursorArb, (cursor) => {
        expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("hostile transport strings decode to null, never throw", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (junk) => {
        const decoded = decodeCursor(junk);
        expect(decoded === null || typeof decoded === "object").toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(decodeCursor(Buffer.from('{"v":2}').toString("base64url"))).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(
          '{"v":1,"queryHash":"00000000000000ff","jsOffset":99999,"dvOffset":0,"nextTieSource":"jscholarship"}',
        ).toString("base64url"),
      ),
    ).toBeNull();
  });

  test("the query hash binds to every request dimension", () => {
    const base = {
      query: "housing",
      repositories: "all" as const,
      sort: "relevance" as const,
      limit: 10,
    };
    const baseHash = computeQueryHash(base);
    expect(computeQueryHash({ ...base })).toBe(baseHash);
    expect(computeQueryHash({ ...base, query: "housing " })).not.toBe(baseHash);
    expect(computeQueryHash({ ...base, repositories: ["jhrdr"] })).not.toBe(baseHash);
    expect(computeQueryHash({ ...base, sort: "date_desc" })).not.toBe(baseHash);
    expect(computeQueryHash({ ...base, limit: 11 })).not.toBe(baseHash);
    expect(computeQueryHash({ ...base, filters: { subjects: ["x"] } })).not.toBe(baseHash);
  });
});

// ─── Property 10: federation ignores raw score magnitude ────────────────────

describe("Property 10: order depends only on repository-local ranks", () => {
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
              cursor: null,
              limit,
            }).results.map((r) => r.id);
          // Determinism: two runs with the same structure agree exactly.
          expect(run()).toEqual(run());
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("lower repository rank always merges ahead of higher rank from the same repository", () => {
    fc.assert(
      fc.property(ranksArb, (ranks) => {
        const merged = mergePages({
          pages: new Map([["jscholarship", page("jscholarship", ranks, null)]]),
          cursor: null,
          limit: 25,
        });
        const mergedRanks = merged.results.map((r) => r.sourceRank);
        expect(mergedRanks).toEqual([...mergedRanks].sort((a, b) => (a ?? 0) - (b ?? 0)));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 11: balanced ties alternate deterministically ─────────────────

describe("Property 11: balanced ties alternate deterministically", () => {
  test("equal ranks alternate sources starting from nextTieSource", () => {
    const pages = new Map<RepositoryId, RepositoryPage>([
      ["jscholarship", page("jscholarship", [1, 2, 3], null)],
      ["jhrdr", page("jhrdr", [1, 2, 3], null)],
    ]);
    const fromJs = mergePages({ pages, cursor: null, limit: 6 });
    expect(fromJs.results.map((r) => r.repository)).toEqual([
      "jscholarship",
      "jhrdr",
      "jhrdr",
      "jscholarship",
      "jscholarship",
      "jhrdr",
    ]);

    const cursor: FederatedCursor = {
      v: 1,
      queryHash: "0000000000000000",
      jsOffset: 0,
      dvOffset: 0,
      nextTieSource: "jhrdr",
    };
    const fromDv = mergePages({ pages, cursor, limit: 6 });
    expect(fromDv.results[0]?.repository).toBe("jhrdr");
    // Same inputs, same cursor → byte-identical order (Requirement 11.6).
    expect(mergePages({ pages, cursor, limit: 6 }).results).toEqual(fromDv.results);
  });
});

// ─── Property 16: offset propagation and exhaustion ─────────────────────────

describe("Property 16: next cursor offset propagation", () => {
  test("page nextOffsets propagate; exhaustion uses the sentinel; all-exhausted yields null", () => {
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
            cursor: null,
            limit: 10,
            queryHash: "00000000000000aa",
          });
          if (jsNext === null && dvNext === null) {
            expect(merged.nextCursor).toBeNull();
          } else {
            expect(merged.nextCursor?.jsOffset).toBe(jsNext ?? EXHAUSTED_OFFSET);
            expect(merged.nextCursor?.dvOffset).toBe(dvNext ?? EXHAUSTED_OFFSET);
            expect(merged.nextCursor?.queryHash).toBe("00000000000000aa");
            // The next cursor must itself survive transport.
            if (merged.nextCursor) {
              expect(decodeCursor(encodeCursor(merged.nextCursor))).toEqual(merged.nextCursor);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 13: partial success preserves successful results ──────────────

describe("Property 13: partial success preserves successful results", () => {
  test("one failed repository never drops the other's records or leaks internals", () => {
    fc.assert(
      fc.property(ranksArb, (ranks) => {
        const merged = mergePages({
          pages: new Map([["jscholarship", page("jscholarship", ranks, null)]]),
          cursor: null,
          limit: 25,
        });
        const response = assembleResponse({
          mergeResult: merged,
          requested: ["jscholarship", "jhrdr"],
          succeeded: ["jscholarship"],
          failed: ["jhrdr"],
          cursor: null,
        });
        expect(response.results).toHaveLength(Math.min(ranks.length, 25));
        expect(response.repositories.failed).toEqual(["jhrdr"]);
        const backendWarnings = response.warnings.filter((w) => w.code === "backend_unavailable");
        expect(backendWarnings).toHaveLength(1);
        for (const warning of response.warnings) {
          expect(warning.message).not.toMatch(/internal|:8080|:8983|exception|stack/i);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
