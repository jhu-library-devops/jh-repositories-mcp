/**
 * Unit Tests: Exact V1→V2 Two-Repository Cursor Mapping
 *
 * **Validates: Requirements 9.1**
 *
 * Exercises the concrete legacy-cursor mapping in `src/federation/cursor.ts`:
 * `mapV1ToV2`, and the end-to-end `decodeCursor` path for a `v:1` token.
 *
 * The legacy two-repository cursor carried `{v:1, queryHash, jsOffset, dvOffset,
 * nextTieSource}`. This suite pins the concrete mapping:
 *   - `jsOffset` maps to the `jscholarship` offset and `dvOffset` to the `jhrdr`
 *     offset (Req 9.1).
 *   - `nextTieSource` maps to its round-robin position within the sorted
 *     two-repository subset `[jhrdr, jscholarship]`: `jhrdr` → 0, `jscholarship`
 *     → 1 (Req 9.1).
 *   - `participating` is the fixed subset sorted lexicographically (Req 9.1).
 *   - a query-hash mismatch resets both offsets and the tie position to zero and
 *     raises a `cursor_reset` warning (Req 9.1, 3.7).
 */

import { describe, expect, test } from "bun:test";
import {
  CURSOR_V2_VERSION,
  type CursorV1,
  decodeCursor,
  mapV1ToV2,
} from "../../src/federation/cursor";
import type { RepositoryId } from "../../src/models/index";

const JSCHOLARSHIP: RepositoryId = "jscholarship";
const JHRDR: RepositoryId = "jhrdr";

/** A valid FNV-1a 64-bit lowercase-hex query hash for fixtures. */
const QUERY_HASH = "0123456789abcdef";
const OTHER_HASH = "fedcba9876543210";

/** The fixed two-repository participating subset, lexicographically sorted. */
const PARTICIPATING: readonly RepositoryId[] = [JHRDR, JSCHOLARSHIP];

/** Build a well-formed V1 cursor fixture with sensible defaults. */
function buildV1(overrides: Partial<CursorV1> = {}): CursorV1 {
  return {
    v: 1,
    queryHash: QUERY_HASH,
    jsOffset: 0,
    dvOffset: 0,
    nextTieSource: JHRDR,
    ...overrides,
  };
}

/** Read a single repository's offset out of the mapped V2 offset map. */
function offsetOf(
  offsets: ReadonlyArray<readonly [RepositoryId, number]>,
  id: RepositoryId,
): number | undefined {
  return offsets.find(([entryId]) => entryId === id)?.[1];
}

describe("mapV1ToV2", () => {
  describe("offset mapping (Req 9.1)", () => {
    test("maps jsOffset to the jscholarship offset and dvOffset to the jhrdr offset", () => {
      const result = mapV1ToV2(buildV1({ jsOffset: 40, dvOffset: 15 }));

      expect(result.error).toBeNull();
      expect(result.warning).toBeUndefined();
      expect(result.cursor).not.toBeNull();

      const cursor = result.cursor;
      if (cursor === null) {
        throw new Error("expected a mapped cursor");
      }
      expect(cursor.v).toBe(CURSOR_V2_VERSION);
      expect(cursor.queryHash).toBe(QUERY_HASH);
      expect(offsetOf(cursor.offsets, JSCHOLARSHIP)).toBe(40);
      expect(offsetOf(cursor.offsets, JHRDR)).toBe(15);
    });

    test("emits offsets and participating lexicographically sorted ([jhrdr, jscholarship])", () => {
      const result = mapV1ToV2(buildV1({ jsOffset: 7, dvOffset: 3 }));

      const cursor = result.cursor;
      if (cursor === null) {
        throw new Error("expected a mapped cursor");
      }
      expect(cursor.participating).toEqual(PARTICIPATING);
      expect(cursor.offsets.map(([id]) => id)).toEqual([JHRDR, JSCHOLARSHIP]);
      expect(cursor.offsets).toEqual([
        [JHRDR, 3],
        [JSCHOLARSHIP, 7],
      ]);
    });
  });

  describe("tie-position mapping (Req 9.1)", () => {
    test("maps nextTieSource 'jhrdr' to tie position 0", () => {
      const result = mapV1ToV2(buildV1({ nextTieSource: JHRDR }));

      expect(result.cursor?.nextTieSequence).toBe(0);
    });

    test("maps nextTieSource 'jscholarship' to tie position 1", () => {
      const result = mapV1ToV2(buildV1({ nextTieSource: JSCHOLARSHIP }));

      expect(result.cursor?.nextTieSequence).toBe(1);
    });
  });

  describe("query-hash mismatch reset (Req 9.1, 3.7)", () => {
    test("resets offsets and tie position to zero with a cursor_reset warning", () => {
      const result = mapV1ToV2(
        buildV1({ jsOffset: 80, dvOffset: 25, nextTieSource: JSCHOLARSHIP }),
        OTHER_HASH,
      );

      expect(result.error).toBeNull();
      expect(result.warning).toBe("cursor_reset");

      const cursor = result.cursor;
      if (cursor === null) {
        throw new Error("expected a reset cursor");
      }
      // Reset adopts the current request's hash and restarts the first page.
      expect(cursor.queryHash).toBe(OTHER_HASH);
      expect(offsetOf(cursor.offsets, JSCHOLARSHIP)).toBe(0);
      expect(offsetOf(cursor.offsets, JHRDR)).toBe(0);
      expect(cursor.nextTieSequence).toBe(0);
      expect(cursor.participating).toEqual(PARTICIPATING);
    });

    test("preserves offsets and tie position when the current hash matches", () => {
      const result = mapV1ToV2(
        buildV1({ jsOffset: 80, dvOffset: 25, nextTieSource: JSCHOLARSHIP }),
        QUERY_HASH,
      );

      expect(result.warning).toBeUndefined();

      const cursor = result.cursor;
      if (cursor === null) {
        throw new Error("expected a mapped cursor");
      }
      expect(cursor.queryHash).toBe(QUERY_HASH);
      expect(offsetOf(cursor.offsets, JSCHOLARSHIP)).toBe(80);
      expect(offsetOf(cursor.offsets, JHRDR)).toBe(25);
      expect(cursor.nextTieSequence).toBe(1);
    });

    test("preserves state when no current hash is supplied", () => {
      const result = mapV1ToV2(buildV1({ jsOffset: 12, dvOffset: 6, nextTieSource: JSCHOLARSHIP }));

      expect(result.warning).toBeUndefined();
      expect(result.cursor?.nextTieSequence).toBe(1);
      expect(offsetOf(result.cursor?.offsets ?? [], JSCHOLARSHIP)).toBe(12);
      expect(offsetOf(result.cursor?.offsets ?? [], JHRDR)).toBe(6);
    });
  });
});

describe("decodeCursor with a v:1 token (Req 9.1)", () => {
  /** Encode a raw v:1 payload as an unpadded base64url transport string. */
  function encodeV1Token(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }

  /** Both legacy ids are registered in the two-repository deployment. */
  const isRegistered = (id: string): boolean => id === JSCHOLARSHIP || id === JHRDR;

  test("decodes and maps a v:1 token end-to-end", () => {
    const token = encodeV1Token({
      v: 1,
      queryHash: QUERY_HASH,
      jsOffset: 20,
      dvOffset: 10,
      nextTieSource: JSCHOLARSHIP,
    });

    const result = decodeCursor(token, isRegistered, QUERY_HASH);

    expect(result.error).toBeNull();
    expect(result.warning).toBeUndefined();

    const cursor = result.cursor;
    if (cursor === null) {
      throw new Error("expected a decoded cursor");
    }
    expect(cursor.v).toBe(CURSOR_V2_VERSION);
    expect(offsetOf(cursor.offsets, JSCHOLARSHIP)).toBe(20);
    expect(offsetOf(cursor.offsets, JHRDR)).toBe(10);
    expect(cursor.nextTieSequence).toBe(1);
    expect(cursor.participating).toEqual(PARTICIPATING);
  });

  test("decodes a v:1 token and resets on a query-hash mismatch", () => {
    const token = encodeV1Token({
      v: 1,
      queryHash: QUERY_HASH,
      jsOffset: 50,
      dvOffset: 30,
      nextTieSource: JSCHOLARSHIP,
    });

    const result = decodeCursor(token, isRegistered, OTHER_HASH);

    expect(result.error).toBeNull();
    expect(result.warning).toBe("cursor_reset");

    const cursor = result.cursor;
    if (cursor === null) {
      throw new Error("expected a reset cursor");
    }
    expect(cursor.queryHash).toBe(OTHER_HASH);
    expect(offsetOf(cursor.offsets, JSCHOLARSHIP)).toBe(0);
    expect(offsetOf(cursor.offsets, JHRDR)).toBe(0);
    expect(cursor.nextTieSequence).toBe(0);
  });

  test("rejects a v:1 token whose nextTieSource is not registered", () => {
    const token = encodeV1Token({
      v: 1,
      queryHash: QUERY_HASH,
      jsOffset: 0,
      dvOffset: 0,
      nextTieSource: "quartex",
    });

    const result = decodeCursor(token, isRegistered, QUERY_HASH);

    expect(result.cursor).toBeNull();
    expect(result.error).toBe("invalid_structure");
  });
});
