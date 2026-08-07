/**
 * Federation Module — Ranking, Cursor Codec, Partial Results
 *
 * Merges repository-local result pages with balanced reciprocal-rank fusion
 * (fusionScore = weight / (60 + repositoryRank)) using equal default weights.
 * Raw Solr scores are never consumed or exposed; ordering depends only on
 * each repository's own rank. Equal-rank ties alternate deterministically
 * between repositories starting from the cursor's nextTieSource, with the
 * stable namespaced record ID as the final tie-breaker.
 *
 * Pagination state lives entirely in a versioned, base64url-encoded cursor
 * (per-repository next unexamined Solr positions + a query-binding hash), so
 * any server task can serve any request. A cursor that no longer matches the
 * normalized query resets pagination to the first page with a cursor_reset
 * warning rather than erroring (Requirement 11.5).
 *
 * Requirements: 1.6, 1.8, 11, 15.3
 */

import type {
  RepositoryId,
  RepositoryPage,
  RepositoryRecord,
  RepositoryWarning,
  SearchRequest,
  SearchResponse,
} from "../models/index";

// ─── Constants ───────────────────────────────────────────────────────────────

/** RRF constant from the design (§8): fusionScore = weight / (RRF_K + rank). */
const RRF_K = 60;

/** Equal default repository weights (Requirement 11.2). */
const DEFAULT_WEIGHT = 1;

/** Mirrors the query layer's bounded result window (MAX_START). */
const MAX_CURSOR_OFFSET = 1000;

/** Decode guard: transport strings longer than this are rejected outright. */
const MAX_ENCODED_CURSOR_LENGTH = 2048;

const REPOSITORY_IDS: readonly RepositoryId[] = ["jscholarship", "jhrdr"];

// ─── Cursor Types ────────────────────────────────────────────────────────────

/**
 * Versioned cursor carrying per-repository pagination state.
 * Encoded as base64url canonical JSON for transport. Each offset is the next
 * unexamined Solr position (startOffset + candidatesConsumed from the
 * previous page); -1 marks an exhausted repository.
 */
export interface FederatedCursorV1 {
  v: 1;
  queryHash: string;
  jsOffset: number;
  dvOffset: number;
  nextTieSource: RepositoryId;
}

export type FederatedCursor = FederatedCursorV1;

/** Sentinel offset marking a repository whose result set is exhausted. */
export const EXHAUSTED_OFFSET = -1;

// ─── Query hash (Requirement 11.4) ───────────────────────────────────────────

/**
 * Deterministic FNV-1a 64-bit hash over the canonical JSON of the normalized
 * query, repositories, filters, sort, and limit. Binds a cursor to the search
 * it belongs to; not a security control (the WAF and input bounds are).
 */
export function computeQueryHash(
  request: Pick<SearchRequest, "query" | "repositories" | "field" | "filters" | "sort" | "limit">,
): string {
  const canonical = canonicalJson({
    query: request.query,
    repositories: request.repositories,
    field: request.field ?? null,
    filters: request.filters ?? null,
    sort: request.sort ?? "relevance",
    limit: request.limit ?? null,
  });
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= BigInt(canonical.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** JSON with lexicographically sorted object keys, for stable hashing. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

// ─── Cursor codec (Requirements 11.4-11.6) ───────────────────────────────────

/**
 * Encode a cursor to an opaque transport string (canonical JSON, base64url).
 */
export function encodeCursor(cursor: FederatedCursor): string {
  return Buffer.from(canonicalJson(cursor), "utf8").toString("base64url");
}

/**
 * Decode a transport string back to a typed cursor.
 * Returns null if the input is malformed, has an unsupported version, or
 * carries out-of-bounds state — callers treat null as invalid input.
 * Query-hash binding is checked separately so a stale-but-well-formed cursor
 * can reset pagination instead of erroring (Requirement 11.5).
 */
export function decodeCursor(encoded: string): FederatedCursor | null {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_CURSOR_LENGTH) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const cursor = parsed as Record<string, unknown>;
  if (cursor.v !== 1) {
    return null;
  }
  if (typeof cursor.queryHash !== "string" || !/^[0-9a-f]{16}$/.test(cursor.queryHash)) {
    return null;
  }
  if (!isValidOffset(cursor.jsOffset) || !isValidOffset(cursor.dvOffset)) {
    return null;
  }
  if (!REPOSITORY_IDS.includes(cursor.nextTieSource as RepositoryId)) {
    return null;
  }
  return {
    v: 1,
    queryHash: cursor.queryHash,
    jsOffset: cursor.jsOffset as number,
    dvOffset: cursor.dvOffset as number,
    nextTieSource: cursor.nextTieSource as RepositoryId,
  };
}

function isValidOffset(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= EXHAUSTED_OFFSET &&
    value <= MAX_CURSOR_OFFSET
  );
}

// ─── Balanced reciprocal-rank merge (Requirements 11.1-11.3, 11.6) ──────────

export interface MergeInput {
  pages: Map<RepositoryId, RepositoryPage>;
  cursor: FederatedCursor | null;
  limit: number;
  /** Query hash to stamp on the next cursor (from computeQueryHash). */
  queryHash?: string;
}

export interface MergeResult {
  results: RepositoryRecord[];
  nextCursor: FederatedCursor | null;
  warnings: RepositoryWarning[];
}

/**
 * Merge repository pages using balanced reciprocal-rank fusion.
 *
 * Two-pointer merge over rank-ordered per-repository lists: at each step the
 * head with the higher fusion score wins; equal scores go to the current
 * preferred source, which then flips (deterministic alternation seeded from
 * the cursor's nextTieSource); the namespaced ID is the final tie-breaker
 * for stability. Raw Solr scores are never consulted.
 */
export function mergePages(input: MergeInput): MergeResult {
  const { pages, cursor, limit } = input;
  const warnings: RepositoryWarning[] = [];
  for (const page of pages.values()) {
    warnings.push(...page.warnings);
  }

  const queues = new Map<RepositoryId, { records: RepositoryRecord[]; index: number }>();
  for (const [repository, page] of pages) {
    queues.set(repository, { records: page.results, index: 0 });
  }

  let preferred: RepositoryId = cursor?.nextTieSource ?? "jscholarship";
  const merged: RepositoryRecord[] = [];

  while (merged.length < limit) {
    let best: { repository: RepositoryId; record: RepositoryRecord; score: number } | null = null;
    let shouldFlipPreferred = false;

    for (const [repository, queue] of queues) {
      const record = queue.records[queue.index];
      if (record === undefined) {
        continue;
      }
      const rank = record.sourceRank ?? Number.MAX_SAFE_INTEGER;
      const score = DEFAULT_WEIGHT / (RRF_K + rank);
      if (best === null || score > best.score) {
        best = { repository, record, score };
        shouldFlipPreferred = false;
      } else if (score === best.score) {
        const preferThis =
          repository === preferred || (best.repository !== preferred && record.id < best.record.id);
        if (preferThis) {
          best = { repository, record, score };
        }
        shouldFlipPreferred = true;
      }
    }

    if (best === null) {
      break;
    }
    if (shouldFlipPreferred) {
      preferred = otherRepository(preferred);
    }
    merged.push(best.record);
    const queue = queues.get(best.repository);
    if (queue) {
      queue.index += 1;
    }
  }

  const nextCursor = buildNextCursor(input, preferred);
  return { results: merged, nextCursor, warnings };
}

function otherRepository(repository: RepositoryId): RepositoryId {
  return repository === "jscholarship" ? "jhrdr" : "jscholarship";
}

function buildNextCursor(input: MergeInput, nextTieSource: RepositoryId): FederatedCursor | null {
  const { pages, cursor, queryHash } = input;
  const offsets: Record<RepositoryId, number> = {
    jscholarship: cursor?.jsOffset ?? EXHAUSTED_OFFSET,
    jhrdr: cursor?.dvOffset ?? EXHAUSTED_OFFSET,
  };
  let anyRemaining = false;
  for (const [repository, page] of pages) {
    if (page.nextOffset === null) {
      offsets[repository] = EXHAUSTED_OFFSET;
    } else {
      offsets[repository] = Math.min(page.nextOffset, MAX_CURSOR_OFFSET);
      anyRemaining = true;
    }
  }
  if (!anyRemaining) {
    return null;
  }
  return {
    v: 1,
    queryHash: queryHash ?? cursor?.queryHash ?? "0000000000000000",
    jsOffset: offsets.jscholarship,
    dvOffset: offsets.jhrdr,
    nextTieSource,
  };
}

// ─── Partial results and response assembly (Requirements 1.8, 15.3) ─────────

/**
 * Repository-qualified warning for a failed backend. The message is fixed
 * text: no internal endpoint, exception detail, or stack ever reaches it.
 */
export function backendUnavailableWarning(repository: RepositoryId): RepositoryWarning {
  return {
    repository,
    code: "backend_unavailable",
    message: `${repository === "jscholarship" ? "JScholarship" : "JHRDR"} was temporarily unavailable; results may be incomplete.`,
  };
}

/** Warning emitted when a stale cursor resets pagination (Requirement 11.5). */
export function cursorResetWarning(repository: RepositoryId): RepositoryWarning {
  return {
    repository,
    code: "cursor_reset",
    message: "The pagination cursor did not match this search and was reset to the first page.",
  };
}

/**
 * Assemble a federated SearchResponse from merge results and metadata.
 */
export function assembleResponse(options: {
  mergeResult: MergeResult;
  requested: RepositoryId[];
  succeeded: RepositoryId[];
  failed: RepositoryId[];
  cursor: string | null;
  extraWarnings?: RepositoryWarning[];
}): SearchResponse {
  const { mergeResult, requested, succeeded, failed, cursor, extraWarnings } = options;
  return {
    results: mergeResult.results,
    count: mergeResult.results.length,
    cursor,
    repositories: { requested, succeeded, failed },
    warnings: [
      ...(extraWarnings ?? []),
      ...failed.map(backendUnavailableWarning),
      ...mergeResult.warnings,
    ],
    retrievedAt: new Date().toISOString(),
  };
}
