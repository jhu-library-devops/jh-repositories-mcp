/**
 * Property-Based Tests: Cursor_V2 Encoding Alphabet and Size Bound
 *
 * Feature: n-repository-federation, Property 2: Cursor encoding alphabet and size bound
 *
 * **Validates: Requirements 3.8, 12.5**
 *
 * The transport string `encodeCursorV2` produces must be a base64url token:
 * it may use only the characters `A–Z a–z 0–9 - _`, must carry no `=` padding,
 * and must stay within `MAX_ENCODED_CURSOR_BYTES` (2048) for payloads of up to
 * eight per-repository offsets.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  type CursorV2,
  MAX_ENCODED_CURSOR_BYTES,
  MAX_REPOSITORY_OFFSET,
  encodeCursorV2,
} from "../../src/federation/cursor";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

/** Exactly the base64url alphabet, anchored over the whole string, padding-free. */
const BASE64URL_ONLY = /^[A-Za-z0-9\-_]*$/;

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A repository id for a participating backend. The encoder treats ids as opaque
 * sort keys, so varied lowercase identifiers exercise it more thoroughly than
 * the two currently registered ids while staying in the real id shape.
 */
const repositoryIdArb: fc.Arbitrary<RepositoryId> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,23}$/)
  .map((id) => id as RepositoryId);

const queryHashArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
  .map((value) => value.toString(16).padStart(16, "0").slice(0, 16));

const offsetArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_REPOSITORY_OFFSET });

/**
 * A `CursorV2` carrying 1–8 per-repository offsets over a matching participating
 * set, mirroring the "up to 8 offsets" bound in Property 2.
 */
const cursorArb: fc.Arbitrary<CursorV2> = fc
  .uniqueArray(repositoryIdArb, { minLength: 1, maxLength: 8 })
  .chain((participating) =>
    fc.record({
      v: fc.constant(2 as const),
      queryHash: queryHashArb,
      offsets: fc.tuple(
        ...participating.map((id) => offsetArb.map((offset) => [id, offset] as const)),
      ),
      participating: fc.constant(participating),
      nextTieSequence: fc.integer({ min: 0, max: participating.length - 1 }),
    }),
  );

// ─── Property 2: encoding alphabet and size bound ────────────────────────────

describe("Feature: n-repository-federation, Property 2: Cursor encoding alphabet and size bound", () => {
  test("encoded cursors use only the base64url alphabet with no padding", () => {
    fc.assert(
      fc.property(cursorArb, (cursor) => {
        const encoded = encodeCursorV2(cursor);
        expect(encoded).toMatch(BASE64URL_ONLY);
        expect(encoded).not.toContain("=");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("encoded cursors stay within the 2048-byte bound for up to 8 offsets", () => {
    fc.assert(
      fc.property(cursorArb, (cursor) => {
        const encoded = encodeCursorV2(cursor);
        expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(MAX_ENCODED_CURSOR_BYTES);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
