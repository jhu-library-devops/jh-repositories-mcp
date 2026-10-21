/**
 * N-Way Reciprocal-Rank Merge (Cursor_V2)
 *
 * Generalizes the v1 two-pointer merge into an N-way reciprocal-rank fusion over
 * a map of per-repository rank queues. Each adapter returns a `RepositoryPage`
 * whose `results` carry a 1-based `sourceRank` — the record's position in that
 * repository's own validated list. The merge never compares raw relevance scores
 * across repositories (Req 4.1); instead it derives a cross-repository ordering
 * key purely from rank and configured weight:
 *
 *   fusionScore = weight / (k + sourceRank)        (Req 4.2)
 *
 * At each step it takes the head with the greatest fusion score across all
 * non-empty queues, appending to the merged list until `limit` is reached or all
 * queues drain (Req 4.3). Every emitted record is stamped with its `sourceRank`
 * and `repository` so each result carries its source attribution (Req 4.6). The
 * next `CursorV2` carries offsets for contributing repositories only, so a
 * repository that returned nothing this page is omitted and re-attempts from its
 * last recorded offset (or zero) on the following page (Req 4.3 cursor emission;
 * partial-result omission is completed in task 11.3).
 *
 * Tie resolution (task 5.2): on an equal fusion-score tie the merge resolves the
 * winner among the tied contributors through the N-way `Tie_Sequence` round-robin
 * (`resolveTieAmong` at the carried ring position), falling through to the ascending
 * namespaced record id only when the sequence prefers the same repository for both
 * tied records (Req 4.4, 5.7). The ring position advances once per tie resolution and
 * is carried into the next cursor's `nextTieSequence` (Req 5.3, 5.4).
 *
 * Passthrough (task 5.2): when exactly one repository is selected, or multiple are
 * selected but only one returned results, that adapter's native ordering is preserved
 * with no fusion re-ranking; when a selected repository returned nothing a warning
 * naming the unavailable repository is emitted (Req 4.7, 4.8). The Federated_Rank is
 * never labeled a probability, confidence, or cross-repository relevance score (Req 4.5).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.7
 */

import type {
  RepositoryId,
  RepositoryPage,
  RepositoryRecord,
  RepositoryWarning,
} from "../models/index";
import type { CursorV2 } from "./cursor";
import type { FusionWeight } from "./limits";
import { type TieSequence, advanceTie, deriveTieSequence, resolveTieAmong } from "./tie-sequence";

// ─── Fusion configuration (design §4) ────────────────────────────────────────

/**
 * Per-repository fusion weight (0.01–100.0 inclusive; absent → 1.0).
 *
 * The canonical `FusionWeight` type lives in the shared federation limits module
 * (`src/federation/limits.ts`); it is re-exported here for existing importers.
 */
export type { FusionWeight };

/** Fusion weight assumed for a repository absent from the weight map (Req 1.6, 4.2). */
const DEFAULT_FUSION_WEIGHT: FusionWeight = 1.0;

/**
 * Reciprocal-rank fusion configuration for a single merge.
 *
 * `k` is the RRF constant (integer 1–1000, default 60) and `weights` carries the
 * resolved Fusion_Weight for each participating repository (design §4).
 */
export interface FusionConfig {
  /** RRF constant k, integer 1–1000, default 60 (Req 4.2). */
  readonly k: number;
  /** Resolved weight per participating repository (Req 1.6, 4.2). */
  readonly weights: ReadonlyMap<RepositoryId, FusionWeight>;
}

// ─── Merge input / output (design §4) ─────────────────────────────────────────

/**
 * Everything the N-way merge needs: the per-repository pages keyed by
 * `RepositoryId`, the participating id set, the incoming cursor (for query-hash
 * and tie-position carry-over), the page `limit`, the `FusionConfig`, and the
 * `queryHash` to stamp on the emitted cursor (design §4).
 */
export interface MergeInput {
  readonly pages: ReadonlyMap<RepositoryId, RepositoryPage>;
  readonly participating: readonly RepositoryId[];
  readonly cursor: CursorV2 | null;
  readonly limit: number;
  readonly fusion: FusionConfig;
  readonly queryHash: string;
}

/**
 * The merged page: the ordered records, the next `CursorV2` (null when every
 * contributing repository is exhausted), and the collected per-repository
 * warnings carried through from the input pages (design §4).
 */
export interface MergeResult {
  readonly results: readonly RepositoryRecord[];
  readonly nextCursor: CursorV2 | null;
  readonly warnings: readonly RepositoryWarning[];
}

// ─── Internal queue model ─────────────────────────────────────────────────────

/** A per-repository rank queue: the page's records and the current head index. */
interface RankQueue {
  readonly repository: RepositoryId;
  readonly records: readonly RepositoryRecord[];
  index: number;
}

/** The current head candidate of a queue, with its derived fusion score. */
interface HeadCandidate {
  readonly repository: RepositoryId;
  readonly record: RepositoryRecord;
  readonly fusionScore: number;
}

/**
 * The outcome of one selection step: the winning head and whether the win was
 * decided by the Tie_Sequence (two or more heads shared the greatest fusion
 * score). The ring position only advances when `tieResolved` is true (Req 5.3).
 */
interface Selection {
  readonly winner: HeadCandidate;
  readonly tieResolved: boolean;
}

// ─── Merge (Req 4.1, 4.2, 4.3, 4.6) ───────────────────────────────────────────

/**
 * Merge per-repository rank queues with weighted reciprocal-rank fusion.
 *
 * Builds one `RankQueue` per contributing page, then repeatedly selects the head
 * with the greatest `fusionScore = weight / (k + sourceRank)` until `limit` is
 * reached or all queues drain (Req 4.2, 4.3). Equal-score ties are resolved by the
 * N-way `Tie_Sequence` among the tied contributors and, finally, the ascending
 * namespaced record id as the stable tiebreak (Req 4.4, 5.7). Each emitted record
 * is re-stamped with its `sourceRank` and `repository` (Req 4.6). Raw Solr scores
 * are never consulted, so no cross-repository raw-score comparison can occur
 * (Req 4.1).
 *
 * When exactly one repository is selected, or multiple are selected but only one
 * returned results, the merge takes the passthrough path: it preserves the lone
 * responding adapter's native ordering with no fusion re-ranking and, for the
 * single-responder case, emits a warning naming each unavailable repository
 * (Req 4.7, 4.8).
 */
export function mergePages(input: MergeInput): MergeResult {
  const { pages, limit } = input;

  const warnings: RepositoryWarning[] = [];
  for (const page of pages.values()) {
    warnings.push(...page.warnings);
  }

  const responders = respondingRepositories(pages);
  if (isPassthrough(input.participating, responders)) {
    return passthroughResult(input, responders, warnings);
  }

  const queues = buildQueues(pages);
  const merged: RepositoryRecord[] = [];
  let tie = deriveTieSequence(input.participating, input.cursor?.nextTieSequence ?? 0);

  while (merged.length < limit) {
    const selection = selectWinner(queues, input.fusion, tie);
    if (selection === null) {
      break;
    }
    merged.push(stampSource(selection.winner.record, selection.winner.repository));
    advance(queues, selection.winner.repository);
    if (selection.tieResolved) {
      tie = advanceTie(tie);
    }
  }

  return {
    results: merged,
    nextCursor: buildNextCursor(input, tie.position),
    warnings,
  };
}

/**
 * Return the repositories whose page contributed at least one result, sorted
 * lexicographically. A repository selected for the query but absent from `pages`,
 * or present with an empty result list, did not respond with results and is not a
 * responder (Req 4.8).
 */
function respondingRepositories(
  pages: ReadonlyMap<RepositoryId, RepositoryPage>,
): readonly RepositoryId[] {
  const responders: RepositoryId[] = [];
  for (const [repository, page] of pages) {
    if (page.results.length > 0) {
      responders.push(repository);
    }
  }
  return responders.sort(compareRepositoryId);
}

/**
 * Decide whether the merge should take the passthrough path (Req 4.7, 4.8).
 *
 * Passthrough applies when exactly one repository is selected (Req 4.7) or when
 * multiple are selected but only one returned results (Req 4.8); in both cases
 * there is nothing to fuse across, so the lone adapter's native ordering is
 * preserved verbatim.
 */
function isPassthrough(
  participating: readonly RepositoryId[],
  responders: readonly RepositoryId[],
): boolean {
  if (participating.length <= 1) {
    return true;
  }
  return responders.length === 1;
}

/**
 * Build a passthrough result that preserves the lone responder's native ordering.
 *
 * No fusion scoring is applied: the responding adapter's own result order is kept
 * as-is, truncated to `limit`, and each record is re-stamped with its source
 * attribution (Req 4.6, 4.7). When the query selected more than one repository but
 * only one responded, a `backend_unavailable` warning is emitted for each selected
 * repository that returned nothing, naming the unavailable repository without
 * leaking endpoints or exception text (Req 4.8). The emitted cursor carries offsets
 * for contributing repositories only and preserves the carried tie position, since
 * no tie was resolved on this page.
 */
function passthroughResult(
  input: MergeInput,
  responders: readonly RepositoryId[],
  warnings: RepositoryWarning[],
): MergeResult {
  const { pages, participating, limit } = input;

  const responder = responders[0];
  const merged: RepositoryRecord[] =
    responder === undefined
      ? []
      : (pages.get(responder)?.results ?? [])
          .slice(0, limit)
          .map((record) => stampSource(record, responder));

  const passthroughWarnings = [...warnings];
  if (participating.length > 1) {
    for (const repository of participating) {
      if (repository !== responder && !hasWarningFor(passthroughWarnings, repository)) {
        passthroughWarnings.push(unavailableWarning(repository));
      }
    }
  }

  return {
    results: merged,
    nextCursor: buildNextCursor(input, input.cursor?.nextTieSequence ?? 0),
    warnings: passthroughWarnings,
  };
}

/** Whether a warning already names the given repository, to avoid duplicate entries. */
function hasWarningFor(warnings: readonly RepositoryWarning[], repository: RepositoryId): boolean {
  return warnings.some((warning) => warning.repository === repository);
}

/**
 * Build the warning naming a selected repository that returned no results so the
 * client learns which repository was unavailable (Req 4.8). The message carries
 * only the repository id — never an endpoint, exception text, or stack trace.
 */
function unavailableWarning(repository: RepositoryId): RepositoryWarning {
  return {
    repository,
    code: "backend_unavailable",
    message: `Repository "${repository}" returned no results and was excluded from this page.`,
  };
}

/** Build a rank queue per contributing page, preserving adapter result order. */
function buildQueues(pages: ReadonlyMap<RepositoryId, RepositoryPage>): RankQueue[] {
  const queues: RankQueue[] = [];
  for (const [repository, page] of pages) {
    queues.push({ repository, records: page.results, index: 0 });
  }
  // Sort by RepositoryId so iteration order — and therefore the baseline tiebreak
  // walk — is deterministic regardless of the order pages were supplied (Req 4.3).
  queues.sort((left, right) => compareRepositoryId(left.repository, right.repository));
  return queues;
}

/**
 * Select the greatest-score head across all non-empty queues.
 *
 * Returns `null` when every queue is drained. The greater `fusionScore` always
 * wins outright (Req 4.2, 4.3). When two or more heads share the greatest fusion
 * score the Tie_Sequence resolves the winner: the repository at the ring position
 * (or the nearest forward contributor) is preferred, and the ascending namespaced
 * record id is the final stable tiebreak when the preferred repository supplies
 * more than one tied head (Req 4.4, 5.7). `tieResolved` reports whether the
 * Tie_Sequence was consulted, so the caller advances the ring position exactly
 * once per resolved tie (Req 5.3).
 */
function selectWinner(
  queues: readonly RankQueue[],
  fusion: FusionConfig,
  tie: TieSequence,
): Selection | null {
  let best: HeadCandidate | null = null;
  const tiedHeads: HeadCandidate[] = [];

  for (const queue of queues) {
    const record = queue.records[queue.index];
    if (record === undefined) {
      continue;
    }
    const candidate: HeadCandidate = {
      repository: queue.repository,
      record,
      fusionScore: fusionScoreOf(record, queue.repository, fusion),
    };
    if (best === null || candidate.fusionScore > best.fusionScore) {
      best = candidate;
      tiedHeads.length = 0;
      tiedHeads.push(candidate);
      continue;
    }
    if (candidate.fusionScore === best.fusionScore) {
      tiedHeads.push(candidate);
    }
  }

  if (best === null) {
    return null;
  }
  if (tiedHeads.length === 1) {
    return { winner: best, tieResolved: false };
  }
  return { winner: resolveEqualScoreTie(tiedHeads, tie), tieResolved: true };
}

/**
 * Resolve an equal fusion-score tie among the tied heads via the Tie_Sequence.
 *
 * The ring (`resolveTieAmong`) selects the preferred repository among the distinct
 * tied contributors by nearest forward position from the carried ring position, so
 * resolution is deterministic and independent of the order pages were supplied
 * (Req 4.4, 5.2, 5.6). When the preferred repository supplies more than one tied
 * head, the lexicographically smaller namespaced record id is the final stable
 * tiebreak (Req 5.7).
 */
function resolveEqualScoreTie(
  tiedHeads: readonly HeadCandidate[],
  tie: TieSequence,
): HeadCandidate {
  const contributors = Array.from(new Set(tiedHeads.map((head) => head.repository)));
  const preferred = resolveTieAmong(tie, contributors);

  let winner: HeadCandidate | null = null;
  for (const head of tiedHeads) {
    if (head.repository !== preferred) {
      continue;
    }
    if (winner === null || head.record.id < winner.record.id) {
      winner = head;
    }
  }

  // `preferred` is always one of the tied contributors, so `winner` is non-null;
  // fall back to the first tied head defensively to satisfy the type checker.
  return winner ?? (tiedHeads[0] as HeadCandidate);
}

/**
 * Compute the weighted reciprocal-rank fusion score for a head record.
 *
 * `fusionScore = weight / (k + sourceRank)` with a 1-based `sourceRank`. A record
 * missing its `sourceRank` is treated as ranked last so a malformed adapter page
 * cannot float to the top (Req 4.1, 4.2). The score is derived only from rank and
 * weight — never from any raw relevance score (Req 4.1).
 */
function fusionScoreOf(
  record: RepositoryRecord,
  repository: RepositoryId,
  fusion: FusionConfig,
): number {
  const rank = record.sourceRank ?? Number.MAX_SAFE_INTEGER;
  const weight = resolveWeight(fusion.weights.get(repository));
  return weight / (fusion.k + rank);
}

/** Resolve a repository's weight, defaulting an absent or non-positive value to 1.0. */
function resolveWeight(weight: FusionWeight | undefined): FusionWeight {
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
    return DEFAULT_FUSION_WEIGHT;
  }
  return weight;
}

/** Stamp the emitted record with its source `repository` and 1-based `sourceRank` (Req 4.6). */
function stampSource(record: RepositoryRecord, repository: RepositoryId): RepositoryRecord {
  if (record.repository === repository && record.sourceRank !== null) {
    return record;
  }
  return { ...record, repository, sourceRank: record.sourceRank };
}

/** Advance the winning repository's queue past its consumed head. */
function advance(queues: readonly RankQueue[], repository: RepositoryId): void {
  for (const queue of queues) {
    if (queue.repository === repository) {
      queue.index += 1;
      return;
    }
  }
}

// ─── Next-cursor emission (Req 4.3) ────────────────────────────────────────────

/**
 * Build the next `CursorV2`, carrying an offset for every contributing
 * repository and omitting any whose page reported no further positions.
 *
 * A contributing repository is one whose page returned a non-null `nextOffset`;
 * its offset is clamped to `MAX_REPOSITORY_OFFSET` so the emitted cursor stays
 * within the bound the decoder enforces. A repository that is exhausted
 * (`nextOffset === null`) is dropped from the offset map entirely, so the next
 * page does not re-request a drained position; failed-repository omission for
 * partial results is completed in task 11.3. When no repository has a further
 * offset the cursor is `null`, signalling the final page (Req 4.3).
 *
 * `participating`, `queryHash`, and the tie position are carried through: the
 * caller passes `nextTieSequence`, which is the ring position after every tie on
 * this page has been resolved (the carried-through position when no tie occurred),
 * so the following page resumes the round-robin where this one left off (Req 5.3,
 * 5.4).
 */
function buildNextCursor(input: MergeInput, nextTieSequence: number): CursorV2 | null {
  const { pages, participating, queryHash } = input;

  const offsets: Array<readonly [RepositoryId, number]> = [];
  for (const [repository, page] of pages) {
    if (page.nextOffset === null) {
      continue;
    }
    offsets.push([repository, Math.min(page.nextOffset, MAX_REPOSITORY_OFFSET)]);
  }

  if (offsets.length === 0) {
    return null;
  }

  return {
    v: 2,
    queryHash,
    offsets: sortOffsets(offsets),
    participating: sortIds(participating),
    nextTieSequence,
  };
}

/** Upper bound on any per-repository offset, mirrored from the cursor codec (Req 3.3, 12.7). */
const MAX_REPOSITORY_OFFSET = 1_000_000;

/** Sort offset pairs lexicographically by RepositoryId for canonical encoding. */
function sortOffsets(
  offsets: readonly (readonly [RepositoryId, number])[],
): ReadonlyArray<readonly [RepositoryId, number]> {
  return [...offsets].sort(([left], [right]) => compareRepositoryId(left, right));
}

/** Deduplicate and sort ids lexicographically for canonical cursor encoding. */
function sortIds(ids: readonly RepositoryId[]): readonly RepositoryId[] {
  return Array.from(new Set(ids)).sort(compareRepositoryId);
}

/** Lexicographic comparison of namespaced repository ids (Req 4.3, 5.7). */
function compareRepositoryId(a: RepositoryId, b: RepositoryId): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
