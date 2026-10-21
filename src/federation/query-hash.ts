/**
 * Normalized Query Hash (Cursor_V2)
 *
 * Computes the FNV-1a 64-bit hash, rendered as lowercase hex matching
 * `^[0-9a-f]{16}$`, that binds a Cursor_V2 to the search it paginates
 * (design.md Cursor_V2 — queryHash). Equivalent requests, after
 * normalization, SHALL produce identical hashes; requests that differ in any
 * hashed dimension SHALL produce differing hashes (Req 3.9, 12.2).
 *
 * Normalization, applied before hashing:
 *   - query text: NFC Unicode normalization, lowercasing, internal whitespace
 *     collapsed to a single space, and trimming (Req 3.9).
 *   - filters: array members normalized and sorted lexicographically, empty
 *     arrays dropped, scalar members normalized (Req 3.9, 12.2).
 *   - selected repositories: `all` kept as a sentinel; an explicit set is
 *     deduplicated and sorted lexicographically.
 *   - sort and limit: folded into the hash, omitted when they equal their
 *     defaults so that an explicit default and an omitted value hash alike.
 *
 * This is a cursor-binding control, not a security control; input bounds and
 * the WAF enforce request safety.
 *
 * Requirements: 3.9, 12.2
 */

import type { RepositoryId, SearchFilters, SearchRequest, SortOption } from "../models/index";

// ─── Defaults (omitted from the hashed payload) ──────────────────────────────

/** Default sort applied when a request omits `sort` (search_items schema). */
const DEFAULT_SORT: SortOption = "relevance";

/** Default page size applied when a request omits `limit` (search_items schema). */
const DEFAULT_LIMIT = 10;

/** FNV-1a 64-bit offset basis. */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;

/** FNV-1a 64-bit prime. */
const FNV_PRIME = 0x100000001b3n;

/** 64-bit mask keeping the FNV accumulator within an unsigned 64-bit range. */
const U64_MASK = 0xffffffffffffffffn;

// ─── Hashed request shape ────────────────────────────────────────────────────

/** The subset of a SearchRequest that participates in the query hash. */
export type HashableRequest = Pick<
  SearchRequest,
  "query" | "repositories" | "field" | "filters" | "sort" | "limit"
>;

/**
 * The canonical, normalized shape fed to the hash. Keys are omitted (left
 * `undefined`, then dropped by canonical JSON) when a value equals its default
 * so that explicit-default and omitted requests hash identically.
 */
interface NormalizedRequest {
  readonly query: string;
  readonly repositories: "all" | readonly RepositoryId[];
  readonly field?: SearchRequest["field"];
  readonly filters?: NormalizedFilters;
  readonly sort?: SortOption;
  readonly limit?: number;
}

/** Normalized filters with sorted arrays and default-empty members dropped. */
interface NormalizedFilters {
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly resourceTypes?: readonly string[];
  readonly creators?: readonly string[];
  readonly subjects?: readonly string[];
  readonly collections?: readonly string[];
  readonly access?: SearchFilters["access"];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the normalized query hash for a search request as FNV-1a 64-bit
 * lowercase hex (16 characters, matching `^[0-9a-f]{16}$`).
 */
export function computeQueryHashV2(request: HashableRequest): string {
  const canonical = canonicalJson(normalizeRequest(request));
  return fnv1a64Hex(canonical);
}

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeRequest(request: HashableRequest): NormalizedRequest {
  return {
    query: normalizeText(request.query),
    repositories: normalizeRepositories(request.repositories),
    field: request.field,
    filters: normalizeFilters(request.filters),
    sort: request.sort === undefined || request.sort === DEFAULT_SORT ? undefined : request.sort,
    limit:
      request.limit === undefined || request.limit === DEFAULT_LIMIT ? undefined : request.limit,
  };
}

/**
 * Normalize free text: NFC Unicode normalization, lowercase, collapse runs of
 * whitespace to one space, and trim (Req 3.9).
 */
function normalizeText(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Normalize the repository selector: `all` is preserved as a sentinel; an
 * explicit list is deduplicated and sorted lexicographically so that selector
 * order does not change the hash.
 */
function normalizeRepositories(
  repositories: HashableRequest["repositories"],
): "all" | readonly RepositoryId[] {
  if (repositories === "all") {
    return "all";
  }
  return Array.from(new Set(repositories)).sort(compareStrings);
}

/**
 * Normalize filters: sort array members lexicographically after normalizing
 * each value, drop empty arrays, and omit unset scalar members. Returns
 * `undefined` when no filter survives so the key is dropped from the hash.
 */
function normalizeFilters(filters: SearchFilters | undefined): NormalizedFilters | undefined {
  if (filters === undefined) {
    return undefined;
  }
  const normalized: Mutable<NormalizedFilters> = {};
  assignScalar(normalized, "dateFrom", filters.dateFrom);
  assignScalar(normalized, "dateTo", filters.dateTo);
  assignArray(normalized, "resourceTypes", filters.resourceTypes);
  assignArray(normalized, "creators", filters.creators);
  assignArray(normalized, "subjects", filters.subjects);
  assignArray(normalized, "collections", filters.collections);
  if (filters.access !== undefined) {
    normalized.access = filters.access;
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function assignScalar(
  target: Mutable<NormalizedFilters>,
  key: "dateFrom" | "dateTo",
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function assignArray(
  target: Mutable<NormalizedFilters>,
  key: "resourceTypes" | "creators" | "subjects" | "collections",
  values: readonly string[] | undefined,
): void {
  if (values === undefined || values.length === 0) {
    return;
  }
  target[key] = Array.from(new Set(values.map(normalizeText)))
    .filter((value) => value.length > 0)
    .sort(compareStrings);
}

// ─── Canonical JSON + FNV-1a ─────────────────────────────────────────────────

/** Lexicographically ordered compare that never returns 0 for distinct keys. */
function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Serialize with object keys sorted and `undefined` members dropped. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
  return `{${entries.join(",")}}`;
}

/** FNV-1a 64-bit over the UTF-16 code units of `text`, as 16-char lowercase hex. */
function fnv1a64Hex(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Local writable view used while assembling the normalized filter object. */
type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};
