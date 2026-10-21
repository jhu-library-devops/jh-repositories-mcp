/**
 * Participating-Set Reconciliation
 *
 * Runs after a cursor decodes cleanly ({@link decodeCursor}) and before the
 * Federation_Service dispatches to any backend. A decoded `CursorV2` describes
 * the pagination state of an earlier request; between pages the registered
 * adapter set, the client's selected subset, or the query itself can change.
 * This module reconciles the decoded cursor against the *current* participating
 * set and query hash, returning the cursor state to page from next plus any
 * `cursor_reset` / `cursor_expanded` warnings the caller must surface
 * (design.md §3 "Participating-set reconciliation", Error Handling rows
 * 3.5/3.6/3.7).
 *
 * The three rules, in precedence order:
 *   (a) query-hash mismatch — the cursor describes a different query, so all
 *       offsets reset to the first page and the tie position resets to zero,
 *       with a `cursor_reset` warning (Req 3.7, 12.8).
 *   (b) a cursor offset id is no longer in the participating set — that id is
 *       dropped and pagination resets to the first page with a `cursor_reset`
 *       warning, because a changed repository set invalidates the carried
 *       positions (Req 3.5).
 *   (c) a newly participating id carries no offset in the cursor (an adapter was
 *       added or newly selected between pages) — that id starts from offset zero
 *       with a `cursor_expanded` warning, while the surviving offsets are kept
 *       (Req 3.6).
 *
 * This is a pure function: it performs no I/O, reads no registry directly, and
 * names no concrete RepositoryId. The caller supplies the current participating
 * set and query hash.
 *
 * Requirements: 3.5, 3.6, 3.7, 12.8
 */

import type { RepositoryId, RepositoryWarning } from "../models/index";
import type { CursorV2 } from "./cursor";

/**
 * The outcome of reconciling a decoded cursor against the current request.
 *
 * `cursor` is the reconciled pagination state the Federation_Service dispatches
 * from: its `offsets` hold only currently-participating ids, its `participating`
 * set equals the current participating set (sorted), and its `queryHash` is the
 * current request hash. `warnings` carries one entry per reconciliation action
 * the client must be told about (`cursor_reset` / `cursor_expanded`); it is empty
 * when nothing changed.
 */
export interface ReconcileResult {
  readonly cursor: CursorV2;
  readonly warnings: readonly RepositoryWarning[];
}

/**
 * Reconcile a cleanly-decoded cursor against the current participating set and
 * query hash.
 *
 * @param cursor the `CursorV2` returned by a clean {@link decodeCursor}.
 * @param participating the current participating RepositoryIds (the resolved
 *   selected/eligible set). Deduplicated and lexicographically sorted internally.
 * @param currentQueryHash the FNV-1a hash of the current normalized request.
 * @returns the reconciled cursor plus any `cursor_reset`/`cursor_expanded`
 *   warnings (design.md §3).
 */
export function reconcileParticipatingSet(
  cursor: CursorV2,
  participating: readonly RepositoryId[],
  currentQueryHash: string,
): ReconcileResult {
  const participatingSet = sortedDistinct(participating);

  // Rule (a): the cursor describes a different query. Reset every offset to the
  // first page and the tie position to zero, warning once per participating id
  // (Req 3.7, 12.8). This dominates the per-id rules below.
  if (cursor.queryHash !== currentQueryHash) {
    return firstPageReset(
      participatingSet,
      currentQueryHash,
      "cursor_reset",
      querySetChangedMessage,
    );
  }

  const decodedOffsets = new Map<RepositoryId, number>(cursor.offsets);

  // Rule (b): any id carried in the cursor that is no longer participating means
  // the repository set changed. Drop it and reset to the first page (Req 3.5).
  const droppedIds = [...decodedOffsets.keys()].filter((id) => !participatingSet.includes(id));
  if (droppedIds.length > 0) {
    return firstPageReset(
      participatingSet,
      currentQueryHash,
      "cursor_reset",
      repositorySetChangedMessage,
    );
  }

  // Rule (c): a newly participating id carries no offset. Start it from zero and
  // keep the surviving offsets, warning once per added id (Req 3.6).
  const warnings: RepositoryWarning[] = [];
  const offsets: Array<readonly [RepositoryId, number]> = [];
  for (const id of participatingSet) {
    const existing = decodedOffsets.get(id);
    if (existing === undefined) {
      offsets.push([id, 0]);
      warnings.push({
        repository: id,
        code: "cursor_expanded",
        message: `Repository ${id} was newly added to this search; it starts from the first page while the other repositories continue from the cursor.`,
      });
    } else {
      offsets.push([id, existing]);
    }
  }

  const reconciled: CursorV2 = {
    v: cursor.v,
    queryHash: currentQueryHash,
    offsets: sortOffsets(offsets),
    participating: participatingSet,
    // The tie position is preserved across an expansion; the ring is re-derived
    // from the participating subset downstream (design.md §5), so a stale index
    // is normalized there rather than reset here.
    nextTieSequence: cursor.nextTieSequence,
  };

  return { cursor: reconciled, warnings };
}

/**
 * Build a first-page cursor over the current participating set, with one warning
 * of the given code and message per participating id.
 *
 * Every offset is zero and the tie position is zero, so pagination restarts from
 * the beginning for the current query (Req 3.5, 3.7).
 */
function firstPageReset(
  participatingSet: readonly RepositoryId[],
  currentQueryHash: string,
  code: RepositoryWarning["code"],
  message: (id: RepositoryId) => string,
): ReconcileResult {
  const offsets: Array<readonly [RepositoryId, number]> = participatingSet.map((id) => [id, 0]);
  const warnings: RepositoryWarning[] = participatingSet.map((id) => ({
    repository: id,
    code,
    message: message(id),
  }));
  const cursor: CursorV2 = {
    v: 2,
    queryHash: currentQueryHash,
    offsets: sortOffsets(offsets),
    participating: participatingSet,
    nextTieSequence: 0,
  };
  return { cursor, warnings };
}

/** Message for a query-hash mismatch reset (Req 3.7, 12.8). */
function querySetChangedMessage(_id: RepositoryId): string {
  return "The query changed since this cursor was issued; results restart from the first page.";
}

/** Message for a repository-set-change reset (Req 3.5). */
function repositorySetChangedMessage(_id: RepositoryId): string {
  return "The participating repository set changed since this cursor was issued; results restart from the first page.";
}

/** Deduplicate and sort ids lexicographically for deterministic encoding. */
function sortedDistinct(ids: readonly RepositoryId[]): readonly RepositoryId[] {
  return Array.from(new Set(ids)).sort(compareRepositoryId);
}

/** Sort offset pairs lexicographically by RepositoryId (Req 3.1, 3.10). */
function sortOffsets(
  offsets: ReadonlyArray<readonly [RepositoryId, number]>,
): ReadonlyArray<readonly [RepositoryId, number]> {
  return [...offsets].sort(([a], [b]) => compareRepositoryId(a, b));
}

/** Lexicographic comparison of namespaced repository ids (design.md §3). */
function compareRepositoryId(a: RepositoryId, b: RepositoryId): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
