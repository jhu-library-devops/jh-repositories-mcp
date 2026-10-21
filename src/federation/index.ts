/**
 * Federation Module — Composition Root (N-Repository)
 *
 * This barrel is the single import surface for the generalized N-repository
 * federation layer. It replaces the former hardcoded two-pointer merge and the
 * fixed-shape `FederatedCursorV1` codec with the registry-resolved N-way
 * pipeline: the selector resolves the participating set, the `Cursor_V2` codec
 * carries variable-length per-repository offsets, the N-way reciprocal-rank
 * merge + tie sequence fuse the pages, facets merge across repositories, and
 * partial-result assembly turns per-adapter outcomes into the client-facing
 * response. Nothing here names a concrete `RepositoryId`; adapters are resolved
 * through the injected `AdapterRegistry` (design.md §1–§7, Req 1.5).
 *
 * The end-to-end `federatedSearch` service composes these pure cores into the
 * search pipeline. Callers that still hold a `Map<RepositoryId, RepositoryAdapter>`
 * bridge it to an `AdapterRegistry` with `createRegistryFromAdapters` until the
 * registry is built at process init (task 15.2).
 *
 * Requirements: 1.5, 3.1, 4.3, 6.1, 7.1, 10.4
 */

// ─── Shared federation types and limits ──────────────────────────────────────

export {
  DEFAULT_FEDERATION_LIMITS,
  DEFAULT_FUSION_WEIGHT,
  DEFAULT_MAX_ADAPTERS,
  DEFAULT_RRF_K,
  MAX_ADAPTERS,
  MAX_FUSION_WEIGHT,
  MAX_RRF_K,
  MIN_ADAPTERS,
  MIN_FUSION_WEIGHT,
  MIN_RRF_K,
} from "./limits";
export type { FederationLimits, WeightConfig } from "./limits";

// ─── Cursor_V2 codec ─────────────────────────────────────────────────────────

export {
  CURSOR_V2_VERSION,
  MAX_ENCODED_CURSOR_BYTES,
  MAX_REPOSITORY_OFFSET,
  decodeCursor,
  encodeCursorV2,
  mapV1ToV2,
} from "./cursor";
export type {
  AnyCursor,
  CursorDecodeErrorCode,
  CursorDecodeResult,
  CursorDecodeWarningCode,
  CursorV1,
  CursorV2,
  IsRegisteredId,
} from "./cursor";

// ─── Query hash + offset computation ─────────────────────────────────────────

export { computeQueryHashV2 } from "./query-hash";
export type { HashableRequest } from "./query-hash";

// ─── N-way reciprocal-rank merge + tie sequence ──────────────────────────────

export { mergePages } from "./merge";
export type { FusionConfig, FusionWeight, MergeInput, MergeResult } from "./merge";
export { advanceTie, deriveTieSequence, resolveTieAmong, tieWinner } from "./tie-sequence";
export type { TieSequence } from "./tie-sequence";

// ─── Selector ─────────────────────────────────────────────────────────────────

export { isSelectorRejection, resolveSelector } from "./selector";
export type {
  RepositorySelector,
  SelectorRejection,
  SelectorRejectionCode,
  SelectorResolution,
} from "./selector";

// ─── Participating-set reconciliation ─────────────────────────────────────────

export { reconcileParticipatingSet } from "./reconcile";
export type { ReconcileResult } from "./reconcile";

// ─── Window allocation + deadline ─────────────────────────────────────────────

export {
  DEFAULT_CANONICALIZATION_BUDGET,
  OVER_FETCH_MULTIPLE,
  allocateFetchWindows,
} from "./window-allocation";
export {
  DEFAULT_DEADLINE_MS,
  MAX_DEADLINE_MS,
  MIN_DEADLINE_MS,
  clampDeadlineMs,
  runUnderDeadline,
} from "./deadline";
export type { DeadlineOptions, DeadlineOutcome } from "./deadline";

// ─── N-way facet merging ──────────────────────────────────────────────────────

export { MAX_FACET_VALUES, isFacetMergeError, mergeFacets, normalizeLabel } from "./facet-merge";
export type { FacetMergeError, RepositoryFacetContribution } from "./facet-merge";

// ─── Partial-result assembly ──────────────────────────────────────────────────

export { assemblePartial } from "./partial-assembly";
export type {
  AdapterFailureCode,
  AdapterOutcome,
  AdapterResult,
  AssemblePartialOptions,
  PartialAssembly,
} from "./partial-assembly";

// ─── Registry bridge ──────────────────────────────────────────────────────────

export { createRegistryFromAdapters } from "./registry-bridge";

// ─── Federation service (end-to-end pipeline) ────────────────────────────────

export { federatedSearch } from "./service";
export type {
  BackendFault,
  FederatedSearchOptions,
  FederatedSearchRequest,
  FederatedSearchResult,
  FederationRejection,
  FederationRejectionCode,
} from "./service";
