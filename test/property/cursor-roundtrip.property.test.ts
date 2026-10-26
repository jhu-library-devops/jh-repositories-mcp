/**
 * Property-Based Tests: Cursor_V2 Round-Trip Identity
 *
 * Feature: n-repository-federation, Property 1: Cursor round-trip identity
 *
 * **Validates: Requirements 3.1, 12.1**
 *
 * Encoding a `CursorV2` and decoding the resulting transport string must
 * reproduce the same pagination state: identical version, query hash, offset
 * map, participating set, and tie position. Because `encodeCursorV2` and
 * `decodeCursor` both order `offsets` and `participating` lexicographically by
 * `RepositoryId`, the expected value is compared after sorting the generated
 * arrays the same way.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  CURSOR_V2_VERSION,
  type CursorV2,
  MAX_REPOSITORY_OFFSET,
  decodeCursor,
  encodeCursorV2,
} from "../../src/federation/cursor";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A repository id for a participating backend. The codec treats ids as opaque
 * sort keys, so varied lowercase identifiers exercise ordering more thoroughly
 * than the two currently registered ids while staying in the real id shape.
 */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,23}$/)
  .map((id) => id as RepositoryId);

/** A lowercase 16-hex-digit query hash matching `^[0-9a-f]{16}$` (Req 3.9). */
const queryHashArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
  .map((value) => value.toString(16).padStart(16, "0").slice(0, 16));

const offsetArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET });

/**
 * A `CursorV2` carrying 1–8 per-repository offsets over a matching participating
 * set, with a non-negative tie position within range.
 */
const cursorArb: fc.Arbitrary<CursorV2> = fc
  .uniqueArray(repositoryIdArb, { minLength: 1, maxLength: 8 })
  .chain((participating) =>
    fc.record({
      v: fc.constant(CURSOR_V2_VERSION),
      queryHash: queryHashArb,
      offsets: fc.tuple(
        ...participating.map((id) => offsetArb.map((offset) => [id, offset] as const)),
      ),
      participating: fc.constant(participating),
      nextTieSequence: fc.integer({ min: 0, max: participating.length - 1 }),
    }),
  );

// ─── Expectation helpers ─────────────────────────────────────────────────────

/** Lexicographic comparison of two repository ids. */
function byRepositoryId(left: RepositoryId, right: RepositoryId): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * The canonical form of a generated cursor: `offsets` and `participating`
 * sorted lexicographically, matching the ordering both the encoder and decoder
 * apply so a deep-equal comparison is order-independent.
 */
function canonicalize(cursor: CursorV2): CursorV2 {
  return {
    v: cursor.v,
    queryHash: cursor.queryHash,
    offsets: [...cursor.offsets].sort(([left], [right]) => byRepositoryId(left, right)),
    participating: [...cursor.participating].sort(byRepositoryId),
    nextTieSequence: cursor.nextTieSequence,
  };
}

// ─── Property 1: round-trip identity ─────────────────────────────────────────

describe("Feature: n-repository-federation, Property 1: Cursor round-trip identity", () => {
  test("encode-then-decode reproduces the original pagination state", () => {
    fc.assert(
      fc.property(cursorArb, (cursor) => {
        const participatingSet = new Set<string>(cursor.participating);
        const isRegistered = (id: string): boolean => participatingSet.has(id);

        const result = decodeCursor(encodeCursorV2(cursor), isRegistered);

        expect(result.error).toBeNull();
        expect(result.cursor).toEqual(canonicalize(cursor));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
