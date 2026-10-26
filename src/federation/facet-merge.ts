/**
 * N-Way Facet Merging
 *
 * Merges the facet responses contributed by every participating repository into
 * a single set of `FacetResult`s. Values whose labels normalize to the same
 * canonical form are combined, their counts summed with a per-repository
 * breakdown, and a single display label chosen from the observed original forms
 * (design.md §7 N-Way Facet Merging).
 *
 * Merge rules (Req 7):
 *   - Values are merged when their labels normalize identically: case-folded,
 *     internal whitespace collapsed, and hyphens, parentheses, and trailing
 *     periods removed (Req 7.1).
 *   - Merged counts are summed and reported with a per-repository breakdown
 *     naming only participating repositories (Req 7.2).
 *   - The display label is the most frequently occurring original form across
 *     contributing repositories; frequency ties break to the form that sorts
 *     first in ascending Unicode order (Req 7.3).
 *   - Each facet returns at most 10 values, ordered by merged count descending
 *     then display label ascending (Req 7.4).
 *   - A synthetic `repository` facet reports each participating repository's
 *     Solr candidate count for the current query and public filters (Req 7.5).
 *   - A facet unsupported by one adapter uses values from supporting adapters
 *     only and is never treated as an error (Req 7.6).
 *   - When every participating adapter fails to return facet data, a structured
 *     backend-unavailability error is returned with no internal endpoints or
 *     exception details (Req 7.7).
 *
 * This is a pure function over the per-repository contributions; it performs no
 * I/O and names no concrete RepositoryId.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import type {
  CommonFacet,
  FacetResult,
  FacetValue,
  RepositoryId,
  ToolError,
} from "../models/index";

// ─── Inputs and outputs ──────────────────────────────────────────────────────

/**
 * One repository's contribution to a federated facet request.
 *
 * `supported` is the set of facets this repository can compute; a facet absent
 * from `supported` is skipped for this repository rather than treated as a
 * zero-count contribution (Req 7.6). `totalMatches` is the repository's Solr
 * candidate count for the current query and public filters, surfaced in the
 * synthetic `repository` facet (Req 7.5).
 */
export interface RepositoryFacetContribution {
  readonly repository: RepositoryId;
  readonly facets: readonly FacetResult[];
  readonly totalMatches: number;
  readonly supported: ReadonlySet<CommonFacet>;
}

/** The maximum number of values returned per facet (Req 7.4). */
export const MAX_FACET_VALUES = 10;

/** Structured error returned when no participating adapter supplied facet data (Req 7.7). */
export interface FacetMergeError {
  readonly error: ToolError;
}

/** Discriminate a structured error from a merged facet list (Req 7.7). */
export function isFacetMergeError(
  result: readonly FacetResult[] | FacetMergeError,
): result is FacetMergeError {
  return "error" in result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Merge per-repository facet contributions into a single list of `FacetResult`s.
 *
 * @returns the merged facets ordered deterministically, or a `FacetMergeError`
 *   with a `backend_unavailable` code when every participating adapter failed to
 *   return facet data (Req 7.7).
 */
export function mergeFacets(
  contributions: readonly RepositoryFacetContribution[],
): FacetResult[] | FacetMergeError {
  if (contributions.length === 0) {
    return backendUnavailableError([]);
  }

  // Every participating adapter failed to return facet data (Req 7.7). A
  // contribution carrying no facet values for any supported facet signals that
  // the repository produced no usable facet response.
  const anyData = contributions.some((contribution) => contributionHasData(contribution));
  if (!anyData) {
    return backendUnavailableError(contributions.map((contribution) => contribution.repository));
  }

  const results: FacetResult[] = [];

  // The synthetic `repository` facet always leads so clients can see which
  // repositories contributed before the content facets (Req 7.5).
  results.push(buildRepositoryFacet(contributions));

  for (const facet of contentFacetsInOrder(contributions)) {
    results.push(mergeContentFacet(facet, contributions));
  }

  return results;
}

// ─── Repository facet (Req 7.5) ──────────────────────────────────────────────

/**
 * Build the synthetic `repository` facet: one value per participating
 * repository, its Solr candidate count for the current query and public
 * filters, ordered by count descending then label ascending (Req 7.4, 7.5).
 */
function buildRepositoryFacet(contributions: readonly RepositoryFacetContribution[]): FacetResult {
  const values: FacetValue[] = contributions.map((contribution) => ({
    label: contribution.repository,
    count: contribution.totalMatches,
    repositoryBreakdown: { [contribution.repository]: contribution.totalMatches },
  }));
  return { facet: "repository", values: orderAndCap(values) };
}

// ─── Content facet merging (Req 7.1–7.4) ─────────────────────────────────────

/**
 * Every content facet (excluding the synthetic `repository` facet) that at least
 * one contribution both supports and returned, in first-seen order across the
 * contributions. Output ordering of facets does not affect per-facet value
 * ordering, which is fully determined by count and label (Req 7.4).
 */
function contentFacetsInOrder(
  contributions: readonly RepositoryFacetContribution[],
): readonly CommonFacet[] {
  const seen = new Set<CommonFacet>();
  const order: CommonFacet[] = [];
  for (const contribution of contributions) {
    for (const result of contribution.facets) {
      if (result.facet === "repository") {
        continue;
      }
      if (!contribution.supported.has(result.facet)) {
        continue;
      }
      if (!seen.has(result.facet)) {
        seen.add(result.facet);
        order.push(result.facet);
      }
    }
  }
  return order;
}

/**
 * Accumulates the merged state for one canonical label across repositories: the
 * summed count, the per-repository breakdown, and the frequency of each observed
 * original label form used to pick the display label (Req 7.2, 7.3).
 */
interface MergedValueAccumulator {
  count: number;
  readonly breakdown: Map<RepositoryId, number>;
  readonly labelFrequency: Map<string, number>;
}

/** Merge a single content facet across all contributions that support it. */
function mergeContentFacet(
  facet: CommonFacet,
  contributions: readonly RepositoryFacetContribution[],
): FacetResult {
  const merged = new Map<string, MergedValueAccumulator>();

  for (const contribution of contributions) {
    if (!contribution.supported.has(facet)) {
      continue; // Unsupported here; use supporting adapters only (Req 7.6).
    }
    const facetResult = contribution.facets.find((result) => result.facet === facet);
    if (facetResult === undefined) {
      continue;
    }
    for (const value of facetResult.values) {
      accumulateValue(merged, contribution.repository, value);
    }
  }

  const values: FacetValue[] = [...merged.values()].map(toFacetValue);
  return { facet, values: orderAndCap(values) };
}

/** Fold one repository's facet value into the merged accumulator for its label. */
function accumulateValue(
  merged: Map<string, MergedValueAccumulator>,
  repository: RepositoryId,
  value: FacetValue,
): void {
  const key = normalizeLabel(value.label);
  const existing = merged.get(key);
  const accumulator: MergedValueAccumulator = existing ?? {
    count: 0,
    breakdown: new Map<RepositoryId, number>(),
    labelFrequency: new Map<string, number>(),
  };

  accumulator.count += value.count;
  accumulator.breakdown.set(repository, (accumulator.breakdown.get(repository) ?? 0) + value.count);
  accumulator.labelFrequency.set(
    value.label,
    (accumulator.labelFrequency.get(value.label) ?? 0) + 1,
  );

  if (existing === undefined) {
    merged.set(key, accumulator);
  }
}

/** Materialize an accumulator into a `FacetValue` with its chosen display label. */
function toFacetValue(accumulator: MergedValueAccumulator): FacetValue {
  const breakdown: Partial<Record<RepositoryId, number>> = {};
  for (const [repository, count] of accumulator.breakdown) {
    breakdown[repository] = count;
  }
  return {
    label: selectDisplayLabel(accumulator.labelFrequency),
    count: accumulator.count,
    repositoryBreakdown: breakdown,
  };
}

/**
 * Choose the display label as the most frequently occurring original form; ties
 * in frequency break to the form that sorts first in ascending Unicode order
 * (Req 7.3).
 */
function selectDisplayLabel(labelFrequency: ReadonlyMap<string, number>): string {
  let best: string | undefined;
  let bestFrequency = -1;
  for (const [label, frequency] of labelFrequency) {
    if (
      frequency > bestFrequency ||
      (frequency === bestFrequency && best !== undefined && compareUnicode(label, best) < 0)
    ) {
      best = label;
      bestFrequency = frequency;
    }
  }
  if (best === undefined) {
    throw new Error("selectDisplayLabel called with no observed label forms");
  }
  return best;
}

// ─── Label normalization (Req 7.1) ───────────────────────────────────────────

/**
 * Normalize a facet label into its canonical merge key: case-fold, collapse
 * internal whitespace to a single space, and remove hyphens, parentheses, and
 * trailing periods (Req 7.1).
 *
 * Hyphens and parentheses are removed before whitespace is collapsed so that a
 * removed character does not fuse two words (e.g. `"World - Wide"` normalizes to
 * `"world wide"`, not `"worldwide"`). Trailing periods are stripped after
 * trimming so a label like `"Ph.D."` reduces to `"phd"`.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFC")
    .toLowerCase()
    .replace(/[-()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .trim();
}

// ─── Ordering and capping (Req 7.4) ──────────────────────────────────────────

/** Order values by count descending then display label ascending, cap at 10 (Req 7.4). */
function orderAndCap(values: readonly FacetValue[]): FacetValue[] {
  return [...values]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return compareUnicode(left.label, right.label);
    })
    .slice(0, MAX_FACET_VALUES);
}

// ─── Backend-unavailability error (Req 7.7) ──────────────────────────────────

/** Build a structured `backend_unavailable` error with no internal detail (Req 7.7). */
function backendUnavailableError(repositories: readonly RepositoryId[]): FacetMergeError {
  const sorted = [...new Set(repositories)].sort(compareUnicode);
  return {
    error: {
      code: "backend_unavailable",
      message: "No repository returned facet data for this request.",
      details: { repositories: sorted },
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Whether a contribution carries at least one value for a facet it supports. */
function contributionHasData(contribution: RepositoryFacetContribution): boolean {
  return contribution.facets.some(
    (result) =>
      result.facet !== "repository" &&
      contribution.supported.has(result.facet) &&
      result.values.length > 0,
  );
}

/** Stable ascending Unicode (code-unit) comparison; never returns 0 for distinct input. */
function compareUnicode(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
