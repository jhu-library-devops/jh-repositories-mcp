/**
 * N-Way Tie Sequence — deterministic, balanced tie-breaking across N repositories.
 *
 * The tie sequence is a round-robin over the participating subset, derived purely
 * from the lexicographic order of the participating ids so it is independent of
 * both registration order and response arrival order (Req 5.1, 5.6). On an
 * equal-score tie the repository at the current position wins (Req 5.2) and the
 * position then advances one step, wrapping to zero after the last id (Req 5.3).
 * The position is seeded from the cursor's `nextTieSequence` and starts at zero
 * for a new query (Req 5.4). When a query selects only a subset of registered
 * repositories, the ring is re-derived from that subset (Req 5.5). When the
 * position points at a repository that is not one of the tied contributors, the
 * tie is resolved among the contributors by nearest forward position in the ring
 * (Req 5.6); the namespaced record id is the final stable tiebreak (Req 5.7).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import type { RepositoryId } from "../models/index";

export interface TieSequence {
  /** Participating ids in lexicographic order; the round-robin ring (Req 5.1, 5.5). */
  readonly order: readonly RepositoryId[];
  /** Current position in `order` (0-based); carried in the cursor (Req 5.4). */
  readonly position: number;
}

/**
 * Build a round-robin ring from the participating subset.
 *
 * `order` is the deduplicated participating ids sorted lexicographically, so the
 * ring is identical regardless of registration order or the full registered set
 * (Req 5.1, 5.5). `startPosition` is seeded from the cursor's `nextTieSequence`
 * (zero for a new query) and is normalized into `[0, order.length)` so a stale or
 * out-of-range position never selects outside the ring (Req 5.4).
 */
export function deriveTieSequence(
  participating: readonly RepositoryId[],
  startPosition: number,
): TieSequence {
  const order = Array.from(new Set(participating)).sort(compareRepositoryId);
  const position = normalizePosition(startPosition, order.length);
  return { order, position };
}

/** The repository preferred at the current position (Req 5.2). */
export function tieWinner(sequence: TieSequence): RepositoryId {
  const winner = sequence.order[sequence.position];
  if (winner === undefined) {
    throw new Error("tieWinner called on an empty tie sequence");
  }
  return winner;
}

/** Advance one step, wrapping to 0 after the last id (Req 5.3). */
export function advanceTie(sequence: TieSequence): TieSequence {
  if (sequence.order.length === 0) {
    return sequence;
  }
  const position = (sequence.position + 1) % sequence.order.length;
  return { order: sequence.order, position };
}

/**
 * Resolve a tie among the actual tied contributors.
 *
 * When the position points at a repository that is one of the tied contributors,
 * that repository wins (Req 5.2). Otherwise the winner is the contributor nearest
 * forward from the current position in the ring, keeping resolution deterministic
 * and independent of response arrival order (Req 5.6). `contributors` must be a
 * non-empty subset of the ring; the final namespaced-id tiebreak (Req 5.7) is
 * handled by the caller when two contributors map to the same repository.
 */
export function resolveTieAmong(
  sequence: TieSequence,
  contributors: readonly RepositoryId[],
): RepositoryId {
  if (contributors.length === 0) {
    throw new Error("resolveTieAmong called with no tied contributors");
  }
  const tied = new Set(contributors);
  const ringSize = sequence.order.length;
  for (let step = 0; step < ringSize; step += 1) {
    const candidate = sequence.order[(sequence.position + step) % ringSize];
    if (candidate !== undefined && tied.has(candidate)) {
      return candidate;
    }
  }
  // No contributor is present in the ring (should not occur for a valid subset);
  // fall back to the lexicographically smallest contributor for stability.
  return [...contributors].sort(compareRepositoryId)[0] as RepositoryId;
}

/** Lexicographic comparison of namespaced repository ids (Req 5.1, 5.7). */
function compareRepositoryId(a: RepositoryId, b: RepositoryId): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Normalize a seeded position into `[0, length)`; zero for an empty ring. */
function normalizePosition(startPosition: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  if (!Number.isFinite(startPosition)) {
    return 0;
  }
  const truncated = Math.trunc(startPosition);
  const wrapped = truncated % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}
