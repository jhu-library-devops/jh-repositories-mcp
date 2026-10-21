/**
 * Property-Based Tests: Cursor Decode Rejects Invalid Tokens Before Backend
 *
 * Feature: n-repository-federation, Property 4: Decode rejects invalid tokens before backend
 *
 * **Validates: Requirements 3.3, 3.4, 12.7**
 *
 * `decodeCursor` must fail closed: any token that is not clean base64url UTF-8
 * JSON, carries an unsupported version, names an unregistered id, or holds an
 * out-of-range / structurally-invalid payload decodes to a rejection
 * (`{ cursor: null, error: <CursorDecodeErrorCode> }`). Because `decodeCursor`
 * is a pure function with no access to any backend, "no backend dispatch" is
 * inherent in the signature — a rejection is the only observable outcome, so the
 * properties below assert the rejection shape across every invalid category.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  CURSOR_V2_VERSION,
  type CursorDecodeResult,
  MAX_REPOSITORY_OFFSET,
  decodeCursor,
  encodeCursorV2,
} from "../../src/federation/cursor";
import type { RepositoryId } from "../../src/models/index";

const NUM_RUNS = 200;

/** The registered ids a generated token may legitimately reference. */
const REGISTERED_IDS: readonly RepositoryId[] = [
  "jscholarship",
  "jhrdr",
  "alpha",
  "beta",
] as RepositoryId[];

const isRegistered = (id: string): boolean => (REGISTERED_IDS as readonly string[]).includes(id);

// ─── Shared generators ───────────────────────────────────────────────────────

/** A valid lowercase 16-hex-digit query hash matching `^[0-9a-f]{16}$` (Req 3.9). */
const validQueryHashArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
  .map((value) => value.toString(16).padStart(16, "0").slice(0, 16));

const registeredIdArb: fc.Arbitrary<RepositoryId> = fc.constantFrom(...REGISTERED_IDS);

/** Encode an arbitrary JSON-serializable payload as a base64url transport token. */
function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Assert a decode result is a rejection: a null cursor and a non-null error. */
function expectRejection(result: CursorDecodeResult): void {
  expect(result.cursor).toBeNull();
  expect(result.error).not.toBeNull();
}

// ─── Category 1: malformed encoding (non-base64url / padded / non-JSON) ──────

/** Strings containing at least one character outside the base64url alphabet. */
const nonBase64urlArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((value) => value.length > 0 && !/^[A-Za-z0-9_-]+$/.test(value));

/** Otherwise-valid base64url tokens that carry standard `=` padding. */
const paddedBase64urlArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .map((raw) => Buffer.from(raw, "utf8").toString("base64"))
  .map((b64) => b64.replace(/\+/g, "-").replace(/\//g, "_"))
  .filter((value) => value.includes("="));

/** Clean base64url whose decoded bytes are valid UTF-8 but not valid JSON. */
const base64urlOfNonJsonArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .map((raw) => `${raw}{not json`)
  .map((text) => Buffer.from(text, "utf8").toString("base64url"))
  .filter((value) => /^[A-Za-z0-9_-]+$/.test(value));

describe("Feature: n-repository-federation, Property 4: Decode rejects invalid tokens before backend", () => {
  test("rejects non-base64url strings as malformed encoding", () => {
    fc.assert(
      fc.property(nonBase64urlArb, (token) => {
        const result = decodeCursor(token, isRegistered);
        expectRejection(result);
        expect(result.error).toBe("malformed_encoding");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("rejects padded base64url tokens as malformed encoding", () => {
    fc.assert(
      fc.property(paddedBase64urlArb, (token) => {
        const result = decodeCursor(token, isRegistered);
        expectRejection(result);
        expect(result.error).toBe("malformed_encoding");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("rejects clean base64url of non-JSON as malformed encoding", () => {
    fc.assert(
      fc.property(base64urlOfNonJsonArb, (token) => {
        const result = decodeCursor(token, isRegistered);
        expectRejection(result);
        expect(result.error).toBe("malformed_encoding");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Category 2: unsupported version ──────────────────────────────────────

  test("rejects supported-shape payloads carrying an unsupported version", () => {
    const unsupportedVersionArb = fc
      .oneof(
        fc.integer({ min: 3, max: 1000 }),
        fc.integer({ min: -1000, max: 0 }),
        fc.constantFrom("2", "v2", true, null),
      )
      .map((v) =>
        encodePayload({
          v,
          queryHash: "0123456789abcdef",
          offsets: [["jscholarship", 0]],
          participating: ["jscholarship"],
          nextTieSequence: 0,
        }),
      );

    fc.assert(
      fc.property(unsupportedVersionArb, (token) => {
        const result = decodeCursor(token, isRegistered);
        expectRejection(result);
        expect(result.error).toBe("unsupported_version");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Category 3: offset out of range (negative / non-integer / over-bound) ─

  test("rejects V2 tokens whose offsets are negative, non-integer, or over-bound", () => {
    const badOffsetArb = fc.oneof(
      fc.integer({ min: -1_000_000, max: -1 }),
      fc.integer({ min: MAX_REPOSITORY_OFFSET + 1, max: MAX_REPOSITORY_OFFSET + 1_000_000 }),
      fc.double({ min: 0.1, max: 0.9, noNaN: true }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY),
    );

    const tokenArb = fc
      .tuple(validQueryHashArb, registeredIdArb, badOffsetArb)
      .map(([queryHash, id, offset]) =>
        encodePayload({
          v: CURSOR_V2_VERSION,
          queryHash,
          offsets: [[id, offset]],
          participating: [id],
          nextTieSequence: 0,
        }),
      );

    fc.assert(
      fc.property(tokenArb, (token) => {
        const result = decodeCursor(token, isRegistered);
        expectRejection(result);
        expect(result.error).toBe("offset_out_of_range");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Category 4: bad query-hash format ────────────────────────────────────

  test("rejects V2 tokens whose query hash is not 16 lowercase hex digits", () => {
    const badQueryHashArb = fc
      .oneof(
        fc.stringMatching(/^[0-9a-f]{1,15}$/), // too short
        fc.stringMatching(/^[0-9a-f]{17,20}$/), // too long
        fc
          .stringMatching(/^[0-9A-F]{16}$/)
          .filter((h) => /[A-F]/.test(h)), // uppercase
        fc.stringMatching(/^[g-z]{16}$/), // non-hex letters
      )
      .filter((h) => !/^[0-9a-f]{16}$/.test(h));

    const tokenArb = fc.tuple(badQueryHashArb, registeredIdArb).map(([queryHash, id]) =>
      encodePayload({
        v: CURSOR_V2_VERSION,
        queryHash,
        offsets: [[id, 0]],
        participating: [id],
        nextTieSequence: 0,
      }),
    );

    fc.assert(
      fc.property(tokenArb, (token) => {
        const result = decodeCursor(token, isRegistered);
        expectRejection(result);
        expect(result.error).toBe("query_hash_format");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Category 5: unregistered ids ─────────────────────────────────────────

  test("rejects V2 tokens naming an unregistered id as invalid structure", () => {
    const unregisteredIdArb = fc
      .stringMatching(/^[a-z][a-z0-9_]{0,23}$/)
      .filter((id) => !isRegistered(id));

    const tokenArb = fc.tuple(validQueryHashArb, unregisteredIdArb).map(([queryHash, id]) =>
      encodePayload({
        v: CURSOR_V2_VERSION,
        queryHash,
        offsets: [[id, 0]],
        participating: [id],
        nextTieSequence: 0,
      }),
    );

    fc.assert(
      fc.property(tokenArb, (token) => {
        const result = decodeCursor(token, isRegistered);
        expectRejection(result);
        expect(result.error).toBe("invalid_structure");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Category 6: structurally-malformed payloads ──────────────────────────

  test("rejects structurally-malformed V2 payloads", () => {
    // Each generator drops or corrupts a required field while keeping the token
    // a supported-version object, so the failure is a structural rejection
    // rather than a version or encoding failure.
    const malformedPayloadArb = fc.oneof(
      // Top-level JSON that is not an object (array / scalar / null).
      fc.constantFrom<unknown>([], [1, 2, 3], 42, "string", null, true),
      // A supported version with a non-array `participating`.
      fc.constant({
        v: CURSOR_V2_VERSION,
        queryHash: "0123456789abcdef",
        offsets: [],
        participating: "jscholarship",
        nextTieSequence: 0,
      }),
      // A supported version with a non-integer `nextTieSequence`.
      fc.constant({
        v: CURSOR_V2_VERSION,
        queryHash: "0123456789abcdef",
        offsets: [["jscholarship", 0]],
        participating: ["jscholarship"],
        nextTieSequence: "first",
      }),
      // A supported version with a negative `nextTieSequence`.
      fc.constant({
        v: CURSOR_V2_VERSION,
        queryHash: "0123456789abcdef",
        offsets: [["jscholarship", 0]],
        participating: ["jscholarship"],
        nextTieSequence: -1,
      }),
      // A supported version with `offsets` not an array.
      fc.constant({
        v: CURSOR_V2_VERSION,
        queryHash: "0123456789abcdef",
        offsets: { jscholarship: 0 },
        participating: ["jscholarship"],
        nextTieSequence: 0,
      }),
      // An offset entry that is not a 2-tuple.
      fc.constant({
        v: CURSOR_V2_VERSION,
        queryHash: "0123456789abcdef",
        offsets: [["jscholarship", 0, "extra"]],
        participating: ["jscholarship"],
        nextTieSequence: 0,
      }),
      // A participating entry that is not a string.
      fc.constant({
        v: CURSOR_V2_VERSION,
        queryHash: "0123456789abcdef",
        offsets: [],
        participating: [42],
        nextTieSequence: 0,
      }),
    );

    fc.assert(
      fc.property(malformedPayloadArb, (payload) => {
        const result = decodeCursor(encodePayload(payload), isRegistered);
        expectRejection(result);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ─── Cross-category: every invalid token yields the rejection shape ───────

  test("every invalid token category decodes to the { cursor: null, error } shape", () => {
    const invalidTokenArb = fc.oneof(
      nonBase64urlArb,
      paddedBase64urlArb,
      base64urlOfNonJsonArb,
      // Unsupported version.
      fc
        .integer({ min: 3, max: 1000 })
        .map((v) => encodePayload({ v, queryHash: "0123456789abcdef", offsets: [] })),
      // Over-bound offset.
      registeredIdArb.map((id) =>
        encodePayload({
          v: CURSOR_V2_VERSION,
          queryHash: "0123456789abcdef",
          offsets: [[id, MAX_REPOSITORY_OFFSET + 1]],
          participating: [id],
          nextTieSequence: 0,
        }),
      ),
    );

    fc.assert(
      fc.property(invalidTokenArb, (token) => {
        expectRejection(decodeCursor(token, isRegistered));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/**
 * Sanity guard: a cleanly-encoded, fully-valid V2 cursor must NOT be rejected,
 * so the rejection properties above are discriminating rather than vacuously
 * true. This is the single positive control for Property 4.
 */
describe("Feature: n-repository-federation, Property 4 (control): valid tokens are not rejected", () => {
  test("a well-formed V2 token decodes without error", () => {
    const validCursorArb = fc
      .uniqueArray(registeredIdArb, { minLength: 1, maxLength: REGISTERED_IDS.length })
      .chain((participating) =>
        fc.record({
          queryHash: validQueryHashArb,
          offsets: fc.tuple(
            ...participating.map((id) =>
              fc
                .integer({ min: 0, max: MAX_REPOSITORY_OFFSET })
                .map((offset) => [id, offset] as const),
            ),
          ),
          participating: fc.constant(participating),
          nextTieSequence: fc.integer({ min: 0, max: participating.length - 1 }),
        }),
      );

    fc.assert(
      fc.property(validCursorArb, (cursor) => {
        const encoded = encodeCursorV2({ v: CURSOR_V2_VERSION, ...cursor });
        const result = decodeCursor(encoded, isRegistered);
        expect(result.error).toBeNull();
        expect(result.cursor).not.toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
