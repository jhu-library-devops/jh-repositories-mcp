/**
 * N-Way Partial-Result Assembly
 *
 * Turns the per-adapter dispatch outcomes and the already-merged page into the
 * client-facing `SearchResponse`, deciding partial-success versus a structured
 * tool error (design §6). The assembly is the single place that classifies each
 * selected repository as succeeded or failed, attaches exactly one
 * repository-qualified warning per failure, populates the
 * `repositories.{requested,succeeded,failed}` metadata, and chooses the emitted
 * cursor.
 *
 * Behavior (Req 6):
 * - When at least one adapter succeeds and one or more fail, return a partial
 *   result with results from all successful adapters (Req 6.1) plus one
 *   repository-qualified warning per failure carrying the id and a
 *   machine-readable code — never an endpoint, exception text, or stack trace
 *   (Req 6.2).
 * - Populate `repositories.requested`, `repositories.succeeded`, and
 *   `repositories.failed` (Req 6.3).
 * - When every selected adapter fails, return a structured MCP tool error with
 *   `isError: true` rather than an empty success (Req 6.4).
 * - The emitted cursor carries offsets for contributing repositories only. The
 *   N-way merge already omits any repository that did not contribute a page, so
 *   a failed repository's offset is absent and the next page re-attempts it from
 *   its last recorded offset, or from zero if none (Req 6.5, 6.6).
 * - A `timeout` outcome maps to a `deadline_exceeded` warning naming the
 *   timed-out repository when results exist (Req 6.7, 10.6).
 * - A `validation_attrition` failure code maps to a `validation_attrition`
 *   warning for a repository whose Canonical API dropped after it had already
 *   validated one or more candidates this page; those validated results are kept
 *   (Req 6.8).
 *
 * This module is pure: it reads the dispatch outcomes and the merge result and
 * returns a `PartialAssembly`. It never inspects repository payloads for access,
 * never names a concrete `RepositoryId`, and never reaches a backend.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

import type {
  RepositoryId,
  RepositoryPage,
  RepositoryWarning,
  SearchResponse,
} from "../models/index";
import type { MergeResult } from "./merge";

// ─── Adapter dispatch outcome model (design §6) ───────────────────────────────

/** Whether a dispatched adapter returned a page, errored, or timed out (Req 6.1, 6.7). */
export type AdapterOutcome = "success" | "error" | "timeout";

/**
 * Machine-readable failure code attached to a failing adapter outcome.
 *
 * Carries no endpoint, exception text, or stack trace (Req 6.2):
 *   - `backend_unavailable` — the backend was unreachable or returned a
 *     non-transient error for this page (Req 6.1).
 *   - `deadline_exceeded` — the overall tool deadline fired before this adapter
 *     responded (Req 6.7).
 *   - `validation_attrition` — the adapter's Canonical API became unavailable
 *     after it had validated one or more candidates this page; the validated
 *     results are retained (Req 6.8).
 *   - `schema_excluded` — the adapter was excluded at startup for failing schema
 *     validation and never dispatched.
 */
export type AdapterFailureCode =
  | "backend_unavailable"
  | "deadline_exceeded"
  | "validation_attrition"
  | "schema_excluded";

/**
 * The outcome of dispatching one selected adapter.
 *
 * `page` is non-null whenever the adapter returned validated results — including
 * the `validation_attrition` case, where the adapter succeeded in returning the
 * candidates it did validate before its Canonical API dropped (Req 6.8).
 * `failureCode` is non-null for every outcome the client must be warned about.
 */
export interface AdapterResult {
  readonly repository: RepositoryId;
  readonly outcome: AdapterOutcome;
  /** The returned page, or null when the adapter produced no results. */
  readonly page: RepositoryPage | null;
  /** Machine-readable failure code; no endpoints or stack traces (Req 6.2). */
  readonly failureCode: AdapterFailureCode | null;
}

// ─── Assembly result (design §6) ──────────────────────────────────────────────

/**
 * The assembled federated response plus the MCP error flag.
 *
 * `isError` is `true` only when every selected adapter failed, signalling a
 * structured tool error rather than an empty success (Req 6.4); it is `false`
 * for partial and full successes (Req 6.1).
 */
export interface PartialAssembly {
  readonly response: SearchResponse;
  readonly isError: boolean;
}

/** Inputs to {@link assemblePartial}. */
export interface AssemblePartialOptions {
  /** The repositories the request targeted, in request order (Req 6.3). */
  readonly requested: readonly RepositoryId[];
  /** One outcome per dispatched adapter. */
  readonly results: readonly AdapterResult[];
  /** The N-way merge output (ordered records + carried warnings) (design §4). */
  readonly mergeResult: MergeResult;
  /**
   * The encoded next cursor, or null on the final page. The merge already
   * omitted failed/exhausted repositories from the offset map before encoding
   * (Req 6.5, 6.6); assembly passes it through verbatim.
   */
  readonly encodedCursor: string | null;
}

// ─── Assembly (Req 6.1–6.8) ───────────────────────────────────────────────────

/**
 * Assemble the partial (or full, or all-failed) federated response.
 *
 * An adapter whose `outcome` is `success` counts as succeeded even when it also
 * carries a `validation_attrition` failure code, because it contributed the
 * candidates it managed to validate (Req 6.8); every other outcome counts as a
 * failure. When at least one adapter succeeded the response is a partial (or
 * full) success carrying the merged results and one warning per failure (Req
 * 6.1–6.3); when all selected adapters failed the response carries no results
 * and `isError` is `true` (Req 6.4). The emitted cursor is the merge's encoded
 * cursor, which already contains offsets for contributing repositories only (Req
 * 6.5, 6.6).
 */
export function assemblePartial(options: AssemblePartialOptions): PartialAssembly {
  const { requested, results, mergeResult, encodedCursor } = options;

  const succeeded: RepositoryId[] = [];
  const failed: RepositoryId[] = [];
  for (const result of results) {
    if (isSuccess(result)) {
      succeeded.push(result.repository);
    } else {
      failed.push(result.repository);
    }
  }

  const failureWarnings = buildFailureWarnings(results, mergeResult.warnings);
  const allFailed = succeeded.length === 0 && results.length > 0;

  const response: SearchResponse = {
    results: allFailed ? [] : [...mergeResult.results],
    count: allFailed ? 0 : mergeResult.results.length,
    cursor: allFailed ? null : encodedCursor,
    repositories: {
      requested: sortIds(requested),
      succeeded: sortIds(succeeded),
      failed: sortIds(failed),
    },
    warnings: [...mergeResult.warnings, ...failureWarnings],
    retrievedAt: new Date().toISOString(),
  };

  return { response, isError: allFailed };
}

/**
 * Whether a dispatched adapter counts as a contributing success.
 *
 * A `success` outcome always counts, including the `validation_attrition` case
 * where the adapter still returned the candidates it validated before its
 * Canonical API dropped (Req 6.8). `error` and `timeout` outcomes are failures
 * (Req 6.1, 6.7).
 */
function isSuccess(result: AdapterResult): boolean {
  return result.outcome === "success";
}

/**
 * Build one repository-qualified warning per failing adapter outcome.
 *
 * Each failing adapter (`error`, `timeout`, or a `validation_attrition` success)
 * yields exactly one warning carrying the repository id and a machine-readable
 * code with fixed human-readable text — never an endpoint, exception text, or
 * stack trace (Req 6.2). A `timeout` maps to `deadline_exceeded` naming the
 * timed-out repository (Req 6.7); a `validation_attrition` failure code maps to
 * a `validation_attrition` warning (Req 6.8); every other failure maps to
 * `backend_unavailable` (Req 6.1). A repository already named by a warning the
 * merge carried through (e.g. an adapter page's own `validation_attrition`) is
 * skipped so the same repository is never warned about twice.
 */
function buildFailureWarnings(
  results: readonly AdapterResult[],
  existingWarnings: readonly RepositoryWarning[],
): RepositoryWarning[] {
  const warnings: RepositoryWarning[] = [];
  const warnedCodes = new Set<string>(
    existingWarnings.map((warning) => warningKey(warning.repository, warning.code)),
  );

  for (const result of results) {
    const code = warningCodeFor(result);
    if (code === null) {
      continue;
    }
    const key = warningKey(result.repository, code);
    if (warnedCodes.has(key)) {
      continue;
    }
    warnedCodes.add(key);
    warnings.push({ repository: result.repository, code, message: warningMessageFor(code) });
  }

  return warnings;
}

/** The warning code an adapter outcome should surface, or null when it succeeded cleanly. */
function warningCodeFor(result: AdapterResult): RepositoryWarning["code"] | null {
  if (result.outcome === "timeout") {
    return "deadline_exceeded";
  }
  if (result.failureCode === "validation_attrition") {
    return "validation_attrition";
  }
  if (result.outcome === "error") {
    return "backend_unavailable";
  }
  return null;
}

/** Fixed, endpoint-free human-readable text for each client-visible warning code (Req 6.2). */
function warningMessageFor(code: RepositoryWarning["code"]): string {
  switch (code) {
    case "deadline_exceeded":
      return "The repository did not respond before the overall deadline; results may be incomplete.";
    case "validation_attrition":
      return "Some matching records could not be validated as public within this page's candidate window; more results may exist on the next page.";
    default:
      return "The repository was temporarily unavailable; results may be incomplete.";
  }
}

/** Composite key identifying a (repository, code) warning pair for deduplication. */
function warningKey(repository: RepositoryId, code: RepositoryWarning["code"]): string {
  return `${repository}:${code}`;
}

/** Deduplicate and lexicographically sort repository ids for deterministic metadata. */
function sortIds(ids: readonly RepositoryId[]): RepositoryId[] {
  return Array.from(new Set(ids)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
