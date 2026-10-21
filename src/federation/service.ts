/**
 * Federation Service — Registry-Resolved N-Way Search Pipeline
 *
 * This is the end-to-end composition that replaces the hardcoded two-adapter
 * dispatch and the `FederatedCursorV1` codec of the former `src/federation/index.ts`.
 * It names no concrete `RepositoryId`: every adapter is resolved through the
 * injected {@link AdapterRegistry}, and the participating set comes from the
 * {@link resolveSelector} result (design.md §1, §2; Req 1.5).
 *
 * The pipeline, in order (design.md "Federated Search Flow"):
 *   1. Resolve the `repositories` selector against the registry; an unknown id
 *      rejects the request before any backend call (Req 2.4).
 *   2. Decode the incoming cursor (V1→V2 mapped) against the registered id set;
 *      a structurally invalid token rejects the request before dispatch
 *      (Req 3.3, 3.4). Reconcile the decoded cursor against the current
 *      participating set and query hash, collecting `cursor_reset` /
 *      `cursor_expanded` warnings (Req 3.5, 3.6, 3.7).
 *   3. Allocate a per-repository fetch window under the canonicalization budget,
 *      reducing proportionally to configured weights when the budget is
 *      exceeded (Req 10.3, 10.4).
 *   4. Dispatch the selected adapters concurrently under the overall tool
 *      deadline; a deadline reached with results yields a partial, with none a
 *      structured error (Req 10.5, 10.6).
 *   5. Run the N-way reciprocal-rank merge + tie sequence over the returned
 *      pages (Req 4.1–4.8, 5.1–5.7).
 *   6. Assemble the partial result — succeeded/failed metadata, one warning per
 *      failure, all-fail structured error — and encode the next `Cursor_V2`
 *      (Req 6.1–6.8, 3.1).
 *
 * The service is backward compatible: with only `jscholarship` and `jhrdr`
 * registered at equal weights, the resolved order, offsets, and warning codes
 * match the former two-repository implementation (Req 9.3).
 *
 * Requirements: 1.5, 3.1, 4.3, 6.1, 10.4
 */

import type { GetOptions, RepositoryAdapter } from "../adapters/index";
import type { AdapterRegistry } from "../adapters/registry";
import type {
  RepositoryId,
  RepositoryPage,
  RepositorySearchRequest,
  RepositoryWarning,
  SearchResponse,
} from "../models/index";
import { type CursorV2, decodeCursor, encodeCursorV2 } from "./cursor";
import { DEFAULT_DEADLINE_MS, runUnderDeadline } from "./deadline";
import { type FusionConfig, mergePages } from "./merge";
import {
  type AdapterOutcome,
  type AdapterResult,
  type PartialAssembly,
  assemblePartial,
} from "./partial-assembly";
import { computeQueryHashV2 } from "./query-hash";
import { reconcileParticipatingSet } from "./reconcile";
import {
  type RepositorySelector,
  type SelectorRejection,
  isSelectorRejection,
  resolveSelector,
} from "./selector";
import { DEFAULT_CANONICALIZATION_BUDGET, allocateFetchWindows } from "./window-allocation";

// ─── Defaults mirrored from FederationLimits (design.md "Configuration") ──────

/** Default RRF constant k (integer 1–1000, default 60) (Req 4.2). */
const DEFAULT_RRF_K = 60;

// ─── Request / result shapes ──────────────────────────────────────────────────

/**
 * The subset of a search request the federation service needs, independent of
 * any particular MCP tool schema. The `repositories` field is the raw selector
 * (`all` / single id / id array / omitted) the service resolves against the
 * registry (Req 2.1–2.4).
 */
export interface FederatedSearchRequest {
  readonly query: string;
  readonly field?: RepositorySearchRequest["field"];
  readonly filters?: RepositorySearchRequest["filters"];
  readonly sort?: RepositorySearchRequest["sort"];
  readonly limit: number;
  readonly repositories: RepositorySelector;
  /** Opaque transport cursor from a previous page, if any. */
  readonly cursor?: string;
}

/** Per-request tuning for the federation pipeline; every field is optional. */
export interface FederatedSearchOptions {
  /** RRF constant k; defaults to 60 (Req 4.2). */
  readonly rrfK?: number;
  /** Total canonicalization budget in candidates; defaults to 150 (Req 10.3). */
  readonly canonicalizationBudget?: number;
  /** Overall tool deadline in ms; defaults to 10000 (Req 10.5). */
  readonly deadlineMs?: number;
  /** Receives the backend fault behind a per-repository failure, for logging. */
  readonly onBackendFault?: (fault: BackendFault) => void;
}

/** A sanitized backend-fault record handed to the caller's logging hook. */
export interface BackendFault {
  readonly repository: RepositoryId;
  readonly cause: unknown;
  readonly effect: "partial_results" | "backend_unavailable";
}

/**
 * The outcome of a federated search. `rejection` is non-null only when the
 * selector or cursor was invalid input — the request was rejected before any
 * backend call and `assembly` is null. Otherwise `assembly` carries the
 * assembled `SearchResponse` and the `isError` flag (Req 6.4).
 */
export type FederatedSearchResult =
  | { readonly kind: "rejected"; readonly rejection: FederationRejection }
  | { readonly kind: "assembled"; readonly assembly: PartialAssembly };

/** Machine-readable reason a request was rejected before dispatch (Req 2.4, 3.4). */
export type FederationRejectionCode = "unknown_repository" | "invalid_cursor";

/** A pre-dispatch rejection carrying a machine-readable code and safe message. */
export interface FederationRejection {
  readonly code: FederationRejectionCode;
  readonly message: string;
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Run the registry-resolved N-way search pipeline.
 *
 * Resolves the selector, decodes and reconciles the cursor, allocates fetch
 * windows, dispatches the selected adapters under the overall deadline, runs the
 * N-way merge, and assembles the partial result with the encoded next cursor.
 * Returns a `rejected` result (no backend call made) for an unknown repository
 * or a structurally invalid cursor, and an `assembled` result otherwise.
 */
export async function federatedSearch(
  registry: AdapterRegistry,
  request: FederatedSearchRequest,
  options: FederatedSearchOptions = {},
): Promise<FederatedSearchResult> {
  // 1. Resolve the selector; an unknown id rejects before any backend call.
  const resolution = resolveSelector(request.repositories, registry);
  if (isSelectorRejection(resolution)) {
    return { kind: "rejected", rejection: toRejection(resolution) };
  }
  const selected = resolution.selected;

  // The query hash binds a cursor to the search it paginates. `all` is folded as
  // a sentinel; an explicit set is the resolved participating ids.
  const queryHash = computeQueryHashV2({
    query: request.query,
    repositories: request.repositories === "all" ? "all" : [...selected],
    field: request.field,
    filters: request.filters,
    sort: request.sort,
    limit: request.limit,
  });

  // 2. Decode + reconcile the cursor (V1→V2 mapped). A structurally invalid
  //    token rejects the request before dispatch (Req 3.3, 3.4).
  const resetWarnings: RepositoryWarning[] = [];
  let cursor: CursorV2 | null = null;
  if (request.cursor !== undefined) {
    const decoded = decodeCursor(
      request.cursor,
      (id) => registry.has(id as RepositoryId),
      queryHash,
    );
    if (decoded.error !== null || decoded.cursor === null) {
      return {
        kind: "rejected",
        rejection: {
          code: "invalid_cursor",
          message: "The cursor is malformed or uses an unsupported version.",
        },
      };
    }
    const reconciled = reconcileParticipatingSet(decoded.cursor, selected, queryHash);
    cursor = reconciled.cursor;
    resetWarnings.push(...reconciled.warnings);
    if (decoded.warning === "cursor_reset") {
      // A V1 hash-mismatch reset the mapping; surface it once per participating id.
      for (const id of selected) {
        if (!resetWarnings.some((w) => w.repository === id && w.code === "cursor_reset")) {
          resetWarnings.push(cursorResetWarning(id));
        }
      }
    }
  }

  // 3. Allocate per-repository fetch windows under the canonicalization budget.
  const weights = weightMapFor(registry, selected);
  const windows = allocateFetchWindows({
    selected,
    limit: request.limit,
    weights,
    budget: options.canonicalizationBudget ?? DEFAULT_CANONICALIZATION_BUDGET,
  });

  // 4. Dispatch the selected adapters concurrently under the overall deadline.
  const dispatched = await dispatchSelected({
    registry,
    selected,
    cursor,
    request,
    windows,
    deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    onBackendFault: options.onBackendFault,
  });

  // 5. N-way reciprocal-rank merge + tie sequence over the returned pages.
  const pages = pagesFrom(dispatched.results);
  const fusion: FusionConfig = { k: options.rrfK ?? DEFAULT_RRF_K, weights };
  const mergeResult = mergePages({
    pages,
    participating: selected,
    cursor,
    limit: request.limit,
    fusion,
    queryHash,
  });

  // 6. Encode the next Cursor_V2 and assemble the partial result.
  const encodedCursor =
    mergeResult.nextCursor === null ? null : encodeCursorV2(mergeResult.nextCursor);
  const mergeResultWithResets =
    resetWarnings.length === 0
      ? mergeResult
      : { ...mergeResult, warnings: [...resetWarnings, ...mergeResult.warnings] };

  const assembly = assemblePartial({
    requested: selected,
    results: dispatched.results,
    mergeResult: mergeResultWithResets,
    encodedCursor,
  });

  return { kind: "assembled", assembly };
}

// ─── Dispatch (Req 10.5, 10.6) ──────────────────────────────────────────────

interface DispatchOptions {
  readonly registry: AdapterRegistry;
  readonly selected: readonly RepositoryId[];
  readonly cursor: CursorV2 | null;
  readonly request: FederatedSearchRequest;
  readonly windows: ReadonlyMap<RepositoryId, number>;
  readonly deadlineMs: number;
  readonly onBackendFault?: (fault: BackendFault) => void;
}

interface DispatchOutput {
  readonly results: readonly AdapterResult[];
}

/**
 * Dispatch every selected adapter concurrently, recording each adapter's outcome
 * as it settles so a deadline snapshot reflects whatever has arrived so far.
 *
 * The whole fan-out runs under {@link runUnderDeadline}: if the deadline fires
 * with at least one adapter already returned, the accumulated results are used
 * (the timed-out adapters are recorded as `timeout`); if it fires with nothing,
 * every adapter is recorded as timed out so partial assembly produces the
 * structured deadline error (Req 10.5, 10.6).
 */
async function dispatchSelected(options: DispatchOptions): Promise<DispatchOutput> {
  const { registry, selected, cursor, request, windows, deadlineMs, onBackendFault } = options;

  const offsets = offsetMap(cursor);
  const settled = new Map<RepositoryId, AdapterResult>();
  const causes = new Map<RepositoryId, unknown>();

  const dispatch = Promise.all(
    selected.map(async (repository) => {
      const settledResult = await dispatchOne({
        adapter: registry.get(repository)?.adapter,
        repository,
        request,
        offset: offsets.get(repository) ?? 0,
        window: windows.get(repository) ?? request.limit,
      });
      settled.set(repository, settledResult.result);
      if (settledResult.cause !== undefined) {
        causes.set(repository, settledResult.cause);
      }
      return settledResult.result;
    }),
  );

  const outcome = await runUnderDeadline({
    dispatch,
    deadlineMs,
    snapshotPartial: () => new Map(settled),
    hasPartialResults: (snapshot) =>
      [...snapshot.values()].some((result) => result.outcome === "success"),
  });

  const results =
    outcome.kind === "completed" ? outcome.value : finalizeAfterDeadline(selected, settled);

  reportFaults(results, causes, onBackendFault);
  return { results };
}

interface DispatchOneOptions {
  readonly adapter: RepositoryAdapter | undefined;
  readonly repository: RepositoryId;
  readonly request: FederatedSearchRequest;
  readonly offset: number;
  readonly window: number;
}

/** A dispatched adapter's structured result plus the raw cause of any failure. */
interface DispatchOneResult {
  readonly result: AdapterResult;
  /** The thrown backend cause, for the logging hook only; absent on success. */
  readonly cause?: unknown;
}

/**
 * Dispatch a single adapter's `search` for its per-repository offset and fetch
 * window, reducing the call to a structured {@link AdapterResult}.
 *
 * A thrown adapter call is captured as an `error` outcome with a
 * `backend_unavailable` code — never an endpoint or exception text (Req 6.2) —
 * and the raw cause is returned separately for the logging hook. A missing
 * adapter (selected but not registered) is likewise an error rather than a
 * crash; the selector already rejected unknown ids, so this is defensive.
 */
async function dispatchOne(options: DispatchOneOptions): Promise<DispatchOneResult> {
  const { adapter, repository, request, offset, window } = options;
  if (adapter === undefined) {
    return {
      result: { repository, outcome: "error", page: null, failureCode: "backend_unavailable" },
    };
  }
  try {
    const page = await adapter.search({
      query: request.query,
      field: request.field,
      filters: request.filters,
      sort: request.sort,
      limit: window,
      offset,
    });
    return { result: { repository, outcome: "success", page, failureCode: null } };
  } catch (cause) {
    return {
      result: { repository, outcome: "error", page: null, failureCode: "backend_unavailable" },
      cause,
    };
  }
}

/**
 * Record every selected adapter that had not settled by the deadline as a
 * `timeout` outcome, preserving those that did settle. This produces the
 * `deadline_exceeded` warnings (results present) or structured error (none)
 * in partial assembly (Req 6.7, 10.6).
 */
function finalizeAfterDeadline(
  selected: readonly RepositoryId[],
  settled: ReadonlyMap<RepositoryId, AdapterResult>,
): readonly AdapterResult[] {
  return selected.map((repository) => {
    const existing = settled.get(repository);
    if (existing !== undefined) {
      return existing;
    }
    return {
      repository,
      outcome: "timeout" as AdapterOutcome,
      page: null,
      failureCode: "deadline_exceeded",
    };
  });
}

/** Forward each failing adapter's backend cause to the logging hook, sanitized. */
function reportFaults(
  results: readonly AdapterResult[],
  causes: ReadonlyMap<RepositoryId, unknown>,
  onBackendFault?: (fault: BackendFault) => void,
): void {
  if (onBackendFault === undefined) {
    return;
  }
  const anySucceeded = results.some((result) => result.outcome === "success");
  for (const result of results) {
    if (result.outcome === "success") {
      continue;
    }
    onBackendFault({
      repository: result.repository,
      cause: causes.get(result.repository) ?? null,
      effect: anySucceeded ? "partial_results" : "backend_unavailable",
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build the `FusionConfig` weight map for the participating ids from the registry. */
function weightMapFor(
  registry: AdapterRegistry,
  selected: readonly RepositoryId[],
): ReadonlyMap<RepositoryId, number> {
  const weights = new Map<RepositoryId, number>();
  for (const id of selected) {
    weights.set(id, registry.weightOf(id));
  }
  return weights;
}

/** The per-repository next-offset map carried by the reconciled cursor. */
function offsetMap(cursor: CursorV2 | null): ReadonlyMap<RepositoryId, number> {
  if (cursor === null) {
    return new Map<RepositoryId, number>();
  }
  return new Map(cursor.offsets);
}

/** Collect the pages from successful adapter results, keyed by repository. */
function pagesFrom(results: readonly AdapterResult[]): ReadonlyMap<RepositoryId, RepositoryPage> {
  const pages = new Map<RepositoryId, RepositoryPage>();
  for (const result of results) {
    if (result.page !== null) {
      pages.set(result.repository, result.page);
    }
  }
  return pages;
}

/** Build a `cursor_reset` warning for a repository (Req 3.7, 9.1). */
function cursorResetWarning(repository: RepositoryId): RepositoryWarning {
  return {
    repository,
    code: "cursor_reset",
    message: "The pagination cursor did not match this search and was reset to the first page.",
  };
}

/** Map a selector rejection onto the federation rejection surface (Req 2.4). */
function toRejection(rejection: SelectorRejection): FederationRejection {
  return { code: "unknown_repository", message: rejection.message };
}

// Re-export `GetOptions` so callers composing the service do not reach into the
// adapters module for the related-item path.
export type { GetOptions };
