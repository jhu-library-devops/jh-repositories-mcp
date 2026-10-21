/**
 * Cursor_V2 Codec — Types, Constants, and Canonical Encoder
 *
 * `Cursor_V2` generalizes the fixed two-repository `FederatedCursorV1` shape
 * into a variable-length, lexicographically-ordered per-repository offset map
 * plus the participating id set and a numeric tie-sequence position. This lets
 * pagination work for any participating repository count without re-encoding
 * the model (design §3).
 *
 * This module provides the shared cursor types (`CursorV2`, `CursorV1`,
 * `AnyCursor`) and the forward encoder `encodeCursorV2`. The encoder serializes
 * the payload as canonical JSON (object keys sorted, `undefined` dropped) and
 * base64url-encodes it without padding, so equivalent pagination state always
 * encodes to identical bytes. Decoding, structural validation, and the V1→V2
 * mapping are implemented by later tasks.
 *
 * Requirements: 3.1, 3.8, 3.10, 12.1, 12.3, 12.5
 */

import type { RepositoryId } from "../models/index";

// ─── Constants (shared with task 1) ──────────────────────────────────────────

/** Current cursor schema version. */
export const CURSOR_V2_VERSION = 2 as const;

/** The maximum encoded cursor size, in bytes, after base64url encoding (Req 3.8, 12.5). */
export const MAX_ENCODED_CURSOR_BYTES = 2048;

/** Upper bound on any per-repository offset (Req 3.3, 12.7). */
export const MAX_REPOSITORY_OFFSET = 1_000_000;

// ─── Cursor Types ────────────────────────────────────────────────────────────

/**
 * Versioned, variable-length pagination cursor.
 *
 * `offsets` and `participating` are ordered lexicographically by `RepositoryId`
 * so equivalent pagination state always encodes to the same bytes (Req 3.1, 12.4).
 */
export interface CursorV2 {
  readonly v: 2;
  /** FNV-1a 64-bit lowercase hex of the normalized request (Req 3.1). */
  readonly queryHash: string;
  /**
   * Next unexamined Solr position per participating repository, ordered by
   * RepositoryId lexicographically for deterministic encoding (Req 3.1, 3.10).
   */
  readonly offsets: ReadonlyArray<readonly [RepositoryId, number]>;
  /** The set of participating RepositoryIds, lexicographically sorted (Req 3.1, 12.6). */
  readonly participating: readonly RepositoryId[];
  /** Round-robin index into `participating` for the next tie resolution (Req 3.1, 5.4). */
  readonly nextTieSequence: number;
}

/** Legacy fixed-shape two-repository cursor, accepted for backward compatibility (Req 9.1). */
export interface CursorV1 {
  readonly v: 1;
  readonly queryHash: string;
  readonly jsOffset: number;
  readonly dvOffset: number;
  readonly nextTieSource: RepositoryId;
}

/** Either cursor version as decoded from a transport string. */
export type AnyCursor = CursorV1 | CursorV2;

// ─── Encoder (Req 3.1, 12.1, 12.5) ───────────────────────────────────────────

/**
 * Encode a `CursorV2` to an opaque transport string.
 *
 * The payload is serialized as canonical JSON (object keys sorted, `undefined`
 * dropped) with `offsets` and `participating` ordered lexicographically by
 * `RepositoryId`, then base64url-encoded without padding — using only the
 * characters `A–Z a–z 0–9 - _`. Because the ordering is canonical, equivalent
 * state always encodes to identical bytes (Req 3.1, 12.4).
 *
 * Throws when the encoded result exceeds `MAX_ENCODED_CURSOR_BYTES`, so an
 * over-large cursor fails fast rather than reaching a client (Req 3.8, 12.5).
 */
export function encodeCursorV2(cursor: CursorV2): string {
  const canonical: CursorV2 = {
    v: CURSOR_V2_VERSION,
    queryHash: cursor.queryHash,
    offsets: sortByRepositoryId(cursor.offsets, ([id]) => id),
    participating: sortByRepositoryId(cursor.participating, (id) => id),
    nextTieSequence: cursor.nextTieSequence,
  };
  const encoded = Buffer.from(canonicalJson(canonical), "utf8").toString("base64url");
  if (Buffer.byteLength(encoded, "utf8") > MAX_ENCODED_CURSOR_BYTES) {
    throw new Error(
      `Encoded cursor is ${Buffer.byteLength(encoded, "utf8")} bytes, ` +
        `exceeding the ${MAX_ENCODED_CURSOR_BYTES}-byte limit.`,
    );
  }
  return encoded;
}

/** Return a new array sorted lexicographically by the item's RepositoryId key. */
function sortByRepositoryId<Element>(
  items: readonly Element[],
  keyOf: (item: Element) => RepositoryId,
): Element[] {
  return [...items].sort((left, right) => {
    const leftKey = keyOf(left);
    const rightKey = keyOf(right);
    if (leftKey < rightKey) {
      return -1;
    }
    if (leftKey > rightKey) {
      return 1;
    }
    return 0;
  });
}

/**
 * Serialize a value to JSON with object keys sorted lexicographically and
 * `undefined`-valued keys dropped, so semantically identical payloads produce
 * byte-identical output (Req 12.1).
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
  return `{${entries.join(",")}}`;
}

// ─── Decoder Types (design §3) ───────────────────────────────────────────────

/**
 * Machine-readable reason a transport token was rejected as invalid input.
 *
 * Every member maps to a distinct structural failure the caller can surface
 * without leaking parse internals, so the request is rejected before any
 * backend call (Req 3.3, 3.4, 12.7):
 *   - `malformed_encoding` — not clean base64url, or the bytes are not UTF-8 JSON.
 *   - `unsupported_version` — `v` is present but not a known cursor version.
 *   - `invalid_structure` — a required field is missing or has the wrong type,
 *     including an unregistered id in `offsets`/`participating`.
 *   - `offset_out_of_range` — an offset is not a non-negative integer, or exceeds
 *     `MAX_REPOSITORY_OFFSET`.
 *   - `query_hash_format` — `queryHash` does not match `^[0-9a-f]{16}$`.
 */
export type CursorDecodeErrorCode =
  | "malformed_encoding"
  | "unsupported_version"
  | "invalid_structure"
  | "offset_out_of_range"
  | "query_hash_format";

/**
 * Outcome of decoding a transport token.
 *
 * Exactly one of `cursor` / `error` is non-null: a clean decode yields a
 * normalized `CursorV2` with `error === null`; any validation failure yields a
 * `CursorDecodeErrorCode` with `cursor === null` so the caller rejects the
 * request as invalid input (Req 3.3, 3.4, 12.7).
 */
export interface CursorDecodeResult {
  /** Normalized to V2; a decoded V1 token is mapped here (Req 9.1). */
  readonly cursor: CursorV2 | null;
  /** Non-null only when the token must be rejected as invalid input. */
  readonly error: CursorDecodeErrorCode | null;
  /**
   * A machine-readable pagination-reset reason the caller must surface as a
   * `cursor_reset` warning (Req 9.1, 3.7). Set only when a V1 token decoded
   * cleanly but its query hash did not match the current request, so
   * pagination restarts at the first page; absent otherwise.
   */
  readonly warning?: CursorDecodeWarningCode;
}

/**
 * Machine-readable reason a cleanly-decoded cursor forced a pagination reset
 * that the caller surfaces to the client as a `cursor_reset` warning.
 *
 *   - `cursor_reset` — a V1 token decoded but its query hash did not match the
 *     current request, so all offsets reset to the first page (Req 9.1, 3.7).
 */
export type CursorDecodeWarningCode = "cursor_reset";

/**
 * Predicate deciding whether a RepositoryId is currently registered.
 *
 * `decodeCursor` is a pure function and cannot reach the Adapter_Registry
 * directly, so the caller supplies registration as a predicate — satisfied by
 * `registry.has` (design.md §1). This keeps the decoder free of any hardcoded
 * RepositoryId while still enforcing that every id in the token is live
 * (Req 3.3).
 */
export type IsRegisteredId = (id: string) => boolean;

/**
 * The RepositoryIds a V1 token's fixed offsets map onto (Req 9.1).
 *
 * The legacy two-repository cursor carried `jsOffset`/`dvOffset`; those map to
 * `jscholarship` and `jhrdr` respectively. The V2 participating subset is the
 * lexicographic sort of these two ids, so the round-robin ring is
 * `jhrdr` (position 0), `jscholarship` (position 1) — matching the Tie_Sequence
 * derivation (design.md §3 "V1 → V2 mapping").
 */
const V1_JS_OFFSET_ID = "jscholarship" as const;
const V1_DV_OFFSET_ID = "jhrdr" as const;

/** The fixed two-repository participating subset, lexicographically sorted (Req 9.1). */
const V1_PARTICIPATING: readonly RepositoryId[] = [V1_DV_OFFSET_ID, V1_JS_OFFSET_ID];

/** Lowercase 16-hex-digit query-hash format, FNV-1a 64-bit (Req 3.9, 12.2). */
const QUERY_HASH_PATTERN = /^[0-9a-f]{16}$/;

// ─── Decoder (Req 3.3, 3.4, 12.7) ────────────────────────────────────────────

/**
 * Decode an opaque transport string into a validated `CursorV2`.
 *
 * Validation runs fail-closed and in order: the string must decode cleanly as
 * base64url to UTF-8 JSON; `v` must be a supported version; `queryHash` must
 * match `^[0-9a-f]{16}$`; every id in `offsets`/`participating` must satisfy
 * `isRegistered`; and every offset must be a non-negative integer no greater
 * than `MAX_REPOSITORY_OFFSET`. The first failure returns a
 * `CursorDecodeErrorCode` with a null cursor so the caller rejects the request
 * before any backend call (Req 3.3, 3.4, 12.7).
 *
 * A supported V1 token decodes structurally here and is mapped onto equivalent
 * `CursorV2` state by {@link mapV1ToV2} (Req 9.1). The caller supplies
 * `currentQueryHash` so the mapping can detect a query-hash mismatch and reset
 * pagination to the first page with a `cursor_reset` warning; when it is
 * omitted, a decoded V1 token maps without the mismatch reset.
 */
export function decodeCursor(
  encoded: string,
  isRegistered: IsRegisteredId,
  currentQueryHash?: string,
): CursorDecodeResult {
  const parsed = parseBase64urlJson(encoded);
  if (parsed === PARSE_FAILURE) {
    return rejection("malformed_encoding");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return rejection("invalid_structure");
  }

  const version = (parsed as { readonly v?: unknown }).v;
  if (version === CURSOR_V2_VERSION) {
    return decodeV2(parsed as Record<string, unknown>, isRegistered);
  }
  if (version === 1) {
    return decodeV1(parsed as Record<string, unknown>, isRegistered, currentQueryHash);
  }
  return rejection("unsupported_version");
}

/**
 * Structurally validate a V1 payload, then map it onto `CursorV2` (Req 9.1).
 *
 * A V1 token is a supported version, so it is never rejected as
 * `unsupported_version`. Validation mirrors the V2 path: `queryHash` must match
 * `^[0-9a-f]{16}$`; `jsOffset`/`dvOffset` must be non-negative integers no
 * greater than `MAX_REPOSITORY_OFFSET`; and `nextTieSource` must be a currently
 * registered id. Any failure rejects the request before any backend call
 * (Req 3.3, 3.4, 12.7). On success the payload is handed to {@link mapV1ToV2}.
 */
function decodeV1(
  payload: Record<string, unknown>,
  isRegistered: IsRegisteredId,
  currentQueryHash: string | undefined,
): CursorDecodeResult {
  const { queryHash, jsOffset, dvOffset, nextTieSource } = payload;

  if (typeof queryHash !== "string" || !QUERY_HASH_PATTERN.test(queryHash)) {
    return rejection("query_hash_format");
  }

  if (!isValidOffset(jsOffset) || !isValidOffset(dvOffset)) {
    return rejection("offset_out_of_range");
  }

  if (typeof nextTieSource !== "string" || !isRegistered(nextTieSource)) {
    return rejection("invalid_structure");
  }

  const v1: CursorV1 = {
    v: 1,
    queryHash,
    jsOffset,
    dvOffset,
    nextTieSource: nextTieSource as RepositoryId,
  };
  return mapV1ToV2(v1, currentQueryHash);
}

/** Non-negative integer within the per-repository offset bound (Req 3.3, 12.7). */
function isValidOffset(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_REPOSITORY_OFFSET
  );
}

/**
 * Map a structurally-valid V1 cursor onto equivalent `CursorV2` state (Req 9.1).
 *
 * `jsOffset → jscholarship`, `dvOffset → jhrdr`, and `nextTieSource` to the
 * round-robin position of that id within the sorted two-repository participating
 * subset — `jhrdr` → 0, `jscholarship` → 1 — matching the Tie_Sequence ring
 * derivation (design.md §3). The participating set and offset map are emitted in
 * lexicographic order so the mapped state encodes identically to natively-built
 * V2 state.
 *
 * When `currentQueryHash` is provided and differs from the V1 token's hash, the
 * token describes a different query: pagination resets to the first page (both
 * offsets zero, tie position zero) and the result carries a `cursor_reset`
 * warning for the caller to surface (Req 9.1, 3.7). When the hashes match (or no
 * current hash is supplied) the offsets and tie position are preserved.
 */
export function mapV1ToV2(v1: CursorV1, currentQueryHash?: string): CursorDecodeResult {
  const hashMismatch = currentQueryHash !== undefined && currentQueryHash !== v1.queryHash;

  const jsOffset = hashMismatch ? 0 : v1.jsOffset;
  const dvOffset = hashMismatch ? 0 : v1.dvOffset;
  const tiePosition = hashMismatch ? 0 : V1_PARTICIPATING.indexOf(v1.nextTieSource);

  const offsets: Array<readonly [RepositoryId, number]> = [
    [V1_JS_OFFSET_ID, jsOffset],
    [V1_DV_OFFSET_ID, dvOffset],
  ];

  // `currentQueryHash` is non-undefined whenever `hashMismatch` is true (it is
  // part of that condition), but control-flow narrowing does not reach this
  // object literal, so bind the narrowed value explicitly for the mismatch case.
  const resetQueryHash = currentQueryHash ?? v1.queryHash;
  const cursor: CursorV2 = {
    v: CURSOR_V2_VERSION,
    queryHash: hashMismatch ? resetQueryHash : v1.queryHash,
    offsets: sortByRepositoryId(offsets, ([id]) => id),
    participating: [...V1_PARTICIPATING],
    nextTieSequence: tiePosition < 0 ? 0 : tiePosition,
  };

  return hashMismatch ? { cursor, error: null, warning: "cursor_reset" } : { cursor, error: null };
}

/** Validate and normalize a V2 payload into a `CursorV2` (design §3). */
function decodeV2(
  payload: Record<string, unknown>,
  isRegistered: IsRegisteredId,
): CursorDecodeResult {
  const { queryHash, offsets, participating, nextTieSequence } = payload;

  if (typeof queryHash !== "string" || !QUERY_HASH_PATTERN.test(queryHash)) {
    return rejection("query_hash_format");
  }

  if (!Array.isArray(participating) || !Number.isInteger(nextTieSequence)) {
    return rejection("invalid_structure");
  }
  const tieSequence = nextTieSequence as number;
  if (tieSequence < 0) {
    return rejection("invalid_structure");
  }

  const participatingIds: RepositoryId[] = [];
  for (const id of participating) {
    if (typeof id !== "string" || !isRegistered(id)) {
      return rejection("invalid_structure");
    }
    participatingIds.push(id as RepositoryId);
  }

  if (!Array.isArray(offsets)) {
    return rejection("invalid_structure");
  }
  const offsetPairs: Array<readonly [RepositoryId, number]> = [];
  for (const entry of offsets) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return rejection("invalid_structure");
    }
    const [id, offset] = entry as [unknown, unknown];
    if (typeof id !== "string" || !isRegistered(id)) {
      return rejection("invalid_structure");
    }
    if (!Number.isInteger(offset)) {
      return rejection("offset_out_of_range");
    }
    const offsetValue = offset as number;
    if (offsetValue < 0 || offsetValue > MAX_REPOSITORY_OFFSET) {
      return rejection("offset_out_of_range");
    }
    offsetPairs.push([id as RepositoryId, offsetValue]);
  }

  const cursor: CursorV2 = {
    v: CURSOR_V2_VERSION,
    queryHash,
    offsets: sortByRepositoryId(offsetPairs, ([id]) => id),
    participating: sortByRepositoryId(participatingIds, (id) => id),
    nextTieSequence: tieSequence,
  };
  return { cursor, error: null };
}

/** Sentinel distinguishing a parse failure from a legitimately-decoded `null`. */
const PARSE_FAILURE: unique symbol = Symbol("cursor.parseFailure");

/**
 * Decode base64url to UTF-8 and parse as JSON.
 *
 * Returns the `PARSE_FAILURE` sentinel when the input is not clean base64url or
 * is not valid UTF-8 JSON, so the caller can map it to `malformed_encoding`
 * without conflating it with a decoded JSON `null` (Req 3.3).
 */
function parseBase64urlJson(encoded: string): unknown {
  if (typeof encoded !== "string" || encoded.length === 0) {
    return PARSE_FAILURE;
  }
  // Reject any character outside the unpadded base64url alphabet before
  // decoding, since `Buffer.from(..., "base64url")` silently ignores stray input.
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return PARSE_FAILURE;
  }
  let json: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    // Round-trip guard: re-encoding must reproduce the input, rejecting tokens
    // that carry padding or otherwise do not canonically round-trip.
    if (bytes.toString("base64url") !== encoded) {
      return PARSE_FAILURE;
    }
    json = bytes.toString("utf8");
  } catch {
    return PARSE_FAILURE;
  }
  try {
    return JSON.parse(json);
  } catch {
    return PARSE_FAILURE;
  }
}

/** Build a rejection result for the given error code. */
function rejection(error: CursorDecodeErrorCode): CursorDecodeResult {
  return { cursor: null, error };
}
