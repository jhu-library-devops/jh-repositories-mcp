/**
 * Shared Federation Types and Limits Model (Canonical)
 *
 * This module is the single source of truth for the federation-wide tuning
 * types that every component shares: the per-repository `FusionWeight`, the
 * `FederationLimits` envelope (with its documented defaults in
 * `DEFAULT_FEDERATION_LIMITS`), and the `WeightConfig` map from `RepositoryId`
 * to `FusionWeight`.
 *
 * The individual limit constants (fusion-weight bounds, canonicalization
 * budget, deadline bounds) keep their canonical home in the module that
 * operates on them — `registry.ts` validates weights, `window-allocation.ts`
 * owns the budget, `deadline.ts` owns the deadline range — so the operational
 * guard and its constant never drift apart. This module re-exports those
 * constants and composes them into the `FederationLimits` model so callers have
 * one place to read the whole limits envelope without creating a second,
 * conflicting source of truth.
 *
 * Requirements: 3.2, 4.2, 10.1, 10.5, 12.5
 */

import { DEFAULT_FUSION_WEIGHT, MAX_FUSION_WEIGHT, MIN_FUSION_WEIGHT } from "../adapters/registry";
import type { RepositoryId } from "../models/index";
import { DEFAULT_DEADLINE_MS, MAX_DEADLINE_MS, MIN_DEADLINE_MS } from "./deadline";
import { DEFAULT_CANONICALIZATION_BUDGET } from "./window-allocation";

// ─── Fusion weight ────────────────────────────────────────────────────────────

/**
 * Per-repository reciprocal-rank fusion weight (0.01–100.0 inclusive; absent
 * → 1.0). This is the canonical shared type; the per-component modules
 * (`registry.ts`, `merge.ts`, `window-allocation.ts`) re-export it so the
 * federation layer has one definition of the weight contract.
 */
export type FusionWeight = number;

// Re-export the fusion-weight bound constants from their operational home
// (`registry.ts`) so the limits model and the weight validator share one value.
export { DEFAULT_FUSION_WEIGHT, MAX_FUSION_WEIGHT, MIN_FUSION_WEIGHT };

// ─── Federation limits ──────────────────────────────────────────────────────

/** Minimum number of adapters that may register, inclusive (Req 10.1). */
export const MIN_ADAPTERS = 2;

/** Maximum number of adapters that may register, inclusive (Req 10.1). */
export const MAX_ADAPTERS = 16;

/** Default maximum adapter count when unconfigured (Req 10.1). */
export const DEFAULT_MAX_ADAPTERS = 8;

/** Minimum reciprocal-rank-fusion constant `k`, inclusive (Req 4.2). */
export const MIN_RRF_K = 1;

/** Maximum reciprocal-rank-fusion constant `k`, inclusive (Req 4.2). */
export const MAX_RRF_K = 1_000;

/** Default reciprocal-rank-fusion constant `k` when unconfigured (Req 4.2). */
export const DEFAULT_RRF_K = 60;

// Re-export the budget and deadline constants from their operational homes so
// the limits model composes the same values the pipeline enforces.
export { DEFAULT_CANONICALIZATION_BUDGET, DEFAULT_DEADLINE_MS, MAX_DEADLINE_MS, MIN_DEADLINE_MS };

/**
 * The federation-wide tuning envelope (design.md "Configuration and Limits").
 *
 * Every field carries a documented range and default:
 * - `maxAdapters` — 2–16, default 8 (Req 10.1).
 * - `rrfK` — 1–1000, default 60 (Req 4.2).
 * - `canonicalizationBudget` — default 150 (Req 10.3).
 * - `deadlineMs` — 1000–10000, default 10000 (Req 10.5).
 *
 * The full interface is additive over the `{ maxAdapters }` subset that
 * `buildRegistry` historically depended on, so a value satisfying this shape is
 * assignable wherever the subset was expected.
 */
export interface FederationLimits {
  /** Maximum number of adapters that may register (2–16, default 8) (Req 10.1). */
  readonly maxAdapters: number;
  /** Reciprocal-rank-fusion constant `k` (1–1000, default 60) (Req 4.2). */
  readonly rrfK: number;
  /** Total canonicalization budget in candidates (default 150) (Req 10.3). */
  readonly canonicalizationBudget: number;
  /** Overall tool deadline in milliseconds (1000–10000, default 10000) (Req 10.5). */
  readonly deadlineMs: number;
}

/** The documented default limits envelope, composed from the per-module defaults. */
export const DEFAULT_FEDERATION_LIMITS: FederationLimits = {
  maxAdapters: DEFAULT_MAX_ADAPTERS,
  rrfK: DEFAULT_RRF_K,
  canonicalizationBudget: DEFAULT_CANONICALIZATION_BUDGET,
  deadlineMs: DEFAULT_DEADLINE_MS,
};

// ─── Weight configuration ─────────────────────────────────────────────────────

/**
 * Resolved per-repository fusion weights for a single request, keyed by
 * `RepositoryId`. An id absent from the map defaults to `1.0` at resolution
 * time (Req 1.6). This is the shared shape consumed by the N-way merge and the
 * fetch-window allocator.
 */
export interface WeightConfig {
  readonly weights: ReadonlyMap<RepositoryId, FusionWeight>;
}
