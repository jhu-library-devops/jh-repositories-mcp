/**
 * Generalized Repository Selector
 *
 * Resolves the user-facing `repositories` input parameter into the concrete,
 * deduplicated set of RepositoryIds the Federation_Service will dispatch to, or
 * rejects the request before any backend call when it names a repository that is
 * not registered. This is a pure function over the Adapter_Registry; it performs
 * no I/O and holds no hardcoded RepositoryId (design.md §2 Repository Selector).
 *
 * Resolution rules:
 *   - `all` or omitted → every eligible adapter (startup schema validation
 *     succeeded). Live health-probe responsiveness is reconciled downstream at
 *     dispatch, where a targeted-but-unavailable adapter yields a per-repository
 *     warning (Req 2.5) or a `backend_unavailable` tool error when every targeted
 *     adapter is unavailable (Req 2.6) (Req 2.1).
 *   - a single RepositoryId → that adapter only (Req 2.2).
 *   - an array → deduplicated to a set, dispatched to the distinct ids (Req 2.3).
 *   - any id not in the registry → a SelectorRejection with code
 *     `unknown_repository`; the request is rejected as invalid input before any
 *     backend call (Req 2.4).
 *
 * The resolved `selected` set is lexicographically sorted so downstream cursor
 * construction and tie-sequence derivation are deterministic (design.md §2, §3).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import type { AdapterRegistry } from "../adapters/registry";
import type { RepositoryId } from "../models/index";

// Re-export the canonical registry type so callers that reach it through the
// selector keep a single source of truth (the interface is owned by
// `src/adapters/registry.ts`).
export type { AdapterRegistry };

/**
 * The slice of the canonical `AdapterRegistry` the selector actually reads. A
 * `Pick` of the canonical type (not a hand-maintained duplicate), so any change
 * to these three members propagates here automatically; the full registry and a
 * minimal structural double both satisfy it (design.md §1, §2).
 */
export type SelectorRegistry = Pick<AdapterRegistry, "registeredIds" | "eligibleIds" | "has">;

/** Wire form accepted on the `repositories` input parameter (Req 9.2, 9.6). */
export type RepositorySelector = "all" | RepositoryId | RepositoryId[] | undefined;

export interface SelectorResolution {
  /** Distinct, lexicographically-sorted ids to dispatch to. */
  readonly selected: readonly RepositoryId[];
}

export type SelectorRejectionCode = "unknown_repository";

export interface SelectorRejection {
  readonly code: SelectorRejectionCode;
  readonly unknownIds: readonly RepositoryId[];
  readonly message: string;
}

/** Discriminate a resolution from a rejection without reading internals. */
export function isSelectorRejection(
  result: SelectorResolution | SelectorRejection,
): result is SelectorRejection {
  return "code" in result;
}

/**
 * Resolve the `repositories` selector against the registry.
 *
 * @returns a `SelectorResolution` with the deduplicated, sorted dispatch set, or
 *   a `SelectorRejection` when the selector names one or more unregistered ids.
 */
export function resolveSelector(
  selector: RepositorySelector,
  registry: SelectorRegistry,
): SelectorResolution | SelectorRejection {
  // `all` or omitted → every eligible adapter (Req 2.1).
  if (selector === undefined || selector === "all") {
    return { selected: sortedDistinct(registry.eligibleIds()) };
  }

  // A single RepositoryId (Req 2.2) or an array (Req 2.3); normalize to a list.
  const requested: readonly RepositoryId[] = Array.isArray(selector) ? selector : [selector];

  // Any id not in the registry rejects the whole request before dispatch (Req 2.4).
  const unknownIds = sortedDistinct(requested.filter((id) => !registry.has(id)));
  if (unknownIds.length > 0) {
    const noun = unknownIds.length === 1 ? "id" : "ids";
    return {
      code: "unknown_repository",
      unknownIds,
      message: `Unknown repository ${noun}: ${unknownIds.join(", ")}`,
    };
  }

  // Deduplicate the array to a set and dispatch to the distinct ids (Req 2.3).
  return { selected: sortedDistinct(requested) };
}

/** Deduplicate and sort ids lexicographically for deterministic downstream use. */
function sortedDistinct(ids: readonly RepositoryId[]): readonly RepositoryId[] {
  return Array.from(new Set(ids)).sort(compareRepositoryId);
}

/** Lexicographic comparison of namespaced repository ids (design.md §2, §3). */
function compareRepositoryId(a: RepositoryId, b: RepositoryId): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
