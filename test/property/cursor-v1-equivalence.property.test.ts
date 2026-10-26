/**
 * Property-Based Tests: V1 Cursor Maps to Equivalent V2 State
 *
 * Feature: n-repository-federation, Property 16: V1 cursor maps to equivalent V2 state
 *
 * **Validates: Requirements 9.1**
 *
 * A legacy `{v:1, queryHash, jsOffset, dvOffset, nextTieSource}` cursor must map
 * onto equivalent `CursorV2` state when the current request's query hash matches
 * the V1 token's hash. Equivalence means the per-repository offsets and tie
 * position are preserved, not reset:
 *   - `jsOffset` maps to the `jscholarship` offset and `dvOffset` to the `jhrdr`
 *     offset (Req 9.1);
 *   - `participating` is the fixed two-repository subset sorted lexicographically,
 *     `[jhrdr, jscholarship]` (Req 9.1);
 *   - `nextTieSource` maps to its round-robin position within that sorted subset:
 *     `jhrdr` → 0, `jscholarship` → 1 (Req 9.1);
 *   - a matching hash preserves state, so no `cursor_reset` warning is emitted.
 *
 * `nextTieSource` is generated over exactly the two registered legacy ids, since
 * a V1 token's tie source is always one of the two repositories whose offsets it
 * carries.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  CURSOR_V2_VERSION,
  type CursorV1,
  MAX_REPOSITORY_OFFSET,
  mapV1ToV2,
} from "../../src/federation/cursor";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

const JSCHOLARSHIP: RepositoryId = "jscholarship";
const JHRDR: RepositoryId = "jhrdr";

/** The fixed two-repository participating subset, lexicographically sorted. */
const PARTICIPATING: readonly RepositoryId[] = [JHRDR, JSCHOLARSHIP];

/** The round-robin tie position of each legacy id within the sorted subset. */
const TIE_POSITION: Readonly<Record<RepositoryId, number>> = {
  [JHRDR]: 0,
  [JSCHOLARSHIP]: 1,
};

// ─── Generators ──────────────────────────────────────────────────────────────

/** A lowercase 16-hex-digit query hash matching `^[0-9a-f]{16}$` (Req 3.9). */
const queryHashArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
  .map((value) => value.toString(16).padStart(16, "0").slice(0, 16));

/** A non-negative integer offset within the per-repository bound (Req 3.3, 12.7). */
const offsetArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET });

/** The tie source is always one of the two legacy repositories a V1 token carries. */
const nextTieSourceArb: fc.Arbitrary<RepositoryId> = fc.constantFrom(JHRDR, JSCHOLARSHIP);

/** A valid legacy V1 cursor over the two registered legacy repositories. */
const v1CursorArb: fc.Arbitrary<CursorV1> = fc.record({
  v: fc.constant(1 as const),
  queryHash: queryHashArb,
  jsOffset: offsetArb,
  dvOffset: offsetArb,
  nextTieSource: nextTieSourceArb,
});

// ─── Expectation helpers ─────────────────────────────────────────────────────

/** Read a single repository's offset out of the mapped V2 offset map. */
function offsetOf(
  offsets: ReadonlyArray<readonly [RepositoryId, number]>,
  id: RepositoryId,
): number | undefined {
  return offsets.find(([entryId]) => entryId === id)?.[1];
}

// ─── Property 16: V1 cursor maps to equivalent V2 state ──────────────────────

describe("Feature: n-repository-federation, Property 16: V1 cursor maps to equivalent V2 state", () => {
  test("a matching query hash maps a V1 cursor onto equivalent V2 offsets and tie position", () => {
    fc.assert(
      fc.property(v1CursorArb, (v1) => {
        // The current request's hash matches the V1 token, so state is preserved.
        const result = mapV1ToV2(v1, v1.queryHash);

        expect(result.error).toBeNull();
        expect(result.warning).toBeUndefined();

        const cursor = result.cursor;
        if (cursor === null) {
          throw new Error("expected a mapped cursor");
        }

        expect(cursor.v).toBe(CURSOR_V2_VERSION);
        expect(cursor.queryHash).toBe(v1.queryHash);

        // Offsets map by source: jsOffset → jscholarship, dvOffset → jhrdr.
        expect(offsetOf(cursor.offsets, JSCHOLARSHIP)).toBe(v1.jsOffset);
        expect(offsetOf(cursor.offsets, JHRDR)).toBe(v1.dvOffset);

        // The participating set is the fixed subset, lexicographically sorted.
        expect(cursor.participating).toEqual(PARTICIPATING);

        // Tie position is the round-robin index of nextTieSource in the subset.
        expect(cursor.nextTieSequence).toBe(TIE_POSITION[v1.nextTieSource]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
