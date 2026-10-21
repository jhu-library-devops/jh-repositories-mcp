/**
 * Federation — Proportional Fetch-Window Allocation (Canonicalization Budget)
 *
 * Each selected repository is over-fetched up to a ceiling of `3 × limit`
 * candidates so the N-way merge has enough headroom to fill a page after
 * public-record validation drops some candidates. The sum of those ceilings
 * (`3 × limit × selectedCount`) is validated against a configurable total
 * canonicalization budget (default 150) per request (Req 10.3). When the sum
 * would exceed the budget, the per-repository windows are reduced proportionally
 * to each repository's configured Fusion_Weight so the windows sum exactly to
 * the budget (Req 10.4).
 *
 * This is a pure function: given the selected ids, the page limit, the weight
 * map, and the budget, it returns the window each repository may fetch. An
 * absent weight defaults to 1.0. Allocation is deterministic and independent of
 * the order the selected ids are supplied.
 *
 * See design.md "Configuration and Limits".
 *
 * Requirements: 10.3, 10.4
 */

import type { RepositoryId } from "../models/index";
import type { FusionWeight } from "./limits";

/**
 * Per-repository fusion weight (0.01–100.0 inclusive; absent → 1.0).
 *
 * The canonical `FusionWeight` type lives in the shared federation limits module
 * (`src/federation/limits.ts`); it is re-exported here for existing importers.
 */
export type { FusionWeight };

/**
 * Total canonicalization budget in candidates (design.md FederationLimits,
 * `canonicalizationBudget`, default 150). This module is the canonical home for
 * the budget constant because it is the allocator that enforces it; the shared
 * `FederationLimits` model composes this same value.
 */
export const DEFAULT_CANONICALIZATION_BUDGET = 150;

/** Over-fetch multiple applied to the page limit for each repository (Req 10.3). */
export const OVER_FETCH_MULTIPLE = 3;

/** Fusion weight assumed for a repository absent from the weight map (Req 1.6, 10.2). */
const DEFAULT_FUSION_WEIGHT = 1.0;

/**
 * Allocate a fetch window to each selected repository under the canonicalization
 * budget.
 *
 * When the sum of per-repository over-fetch ceilings (`3 × limit` each) fits
 * within `budget`, every repository receives its full ceiling. Otherwise the
 * windows are reduced proportionally to configured Fusion_Weights so their sum
 * equals `budget` exactly: each repository's real-valued share is floored, then
 * the leftover (from flooring) is handed out one candidate at a time to the
 * repositories with the largest fractional remainders — ties broken by greater
 * weight, then by lexicographic id — keeping the result deterministic regardless
 * of the order the selected ids are supplied (Req 10.4).
 *
 * Every returned window is a non-negative integer no greater than that
 * repository's own ceiling, and the windows sum to `min(totalCeiling, budget)`.
 *
 * @param options.selected  The repositories to fetch from (deduplicated internally).
 * @param options.limit     The requested page size; must be a positive integer.
 * @param options.weights   Per-repository Fusion_Weights; absent ids default to 1.0.
 * @param options.budget    The total canonicalization budget; must be a positive integer.
 * @throws RangeError if `limit` or `budget` is not a positive integer.
 */
export function allocateFetchWindows(options: {
  readonly selected: readonly RepositoryId[];
  readonly limit: number;
  readonly weights: ReadonlyMap<RepositoryId, FusionWeight>;
  readonly budget: number;
}): ReadonlyMap<RepositoryId, number> {
  const { selected, limit, weights, budget } = options;
  assertPositiveInteger(limit, "limit");
  assertPositiveInteger(budget, "budget");

  const ids = dedupeSorted(selected);
  if (ids.length === 0) {
    return new Map<RepositoryId, number>();
  }

  const ceiling = OVER_FETCH_MULTIPLE * limit;
  const totalCeiling = ceiling * ids.length;

  // Under budget: every repository fetches its full over-fetch ceiling (Req 10.3).
  if (totalCeiling <= budget) {
    return new Map(ids.map((id) => [id, ceiling] as const));
  }

  // Over budget: reduce proportionally to configured weights (Req 10.4).
  return allocateProportional(ids, weights, budget);
}

/**
 * Distribute `budget` candidates across `ids` proportionally to weight.
 *
 * Uses the largest-remainder method so the integer windows sum exactly to
 * `budget`: each share is floored, then the shortfall is awarded to the ids with
 * the largest fractional parts. Ordering of the remainder pass is deterministic
 * (remainder desc, then weight desc, then id asc) so allocation does not depend
 * on input order.
 */
function allocateProportional(
  ids: readonly RepositoryId[],
  weights: ReadonlyMap<RepositoryId, FusionWeight>,
  budget: number,
): ReadonlyMap<RepositoryId, number> {
  const weightOf = (id: RepositoryId): number => resolveWeight(weights.get(id));
  const totalWeight = ids.reduce((sum, id) => sum + weightOf(id), 0);

  const shares = ids.map((id) => {
    const exact = (weightOf(id) * budget) / totalWeight;
    return {
      id,
      weight: weightOf(id),
      floor: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });

  const allocation = new Map<RepositoryId, number>(shares.map((share) => [share.id, share.floor]));
  const floored = shares.reduce((sum, share) => sum + share.floor, 0);
  let leftover = budget - floored;

  const order = [...shares].sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    if (right.weight !== left.weight) {
      return right.weight - left.weight;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  for (const share of order) {
    if (leftover <= 0) {
      break;
    }
    allocation.set(share.id, (allocation.get(share.id) ?? 0) + 1);
    leftover -= 1;
  }

  return allocation;
}

/** Resolve a repository's weight, defaulting an absent or non-finite value to 1.0. */
function resolveWeight(weight: FusionWeight | undefined): number {
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
    return DEFAULT_FUSION_WEIGHT;
  }
  return weight;
}

/** Deduplicate and lexicographically sort the selected ids for deterministic output. */
function dedupeSorted(selected: readonly RepositoryId[]): readonly RepositoryId[] {
  return Array.from(new Set(selected)).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, received ${value}`);
  }
}
