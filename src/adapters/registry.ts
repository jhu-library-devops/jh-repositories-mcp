/**
 * Adapter Registry — Type and Immutable Construction
 *
 * The `AdapterRegistry` owns the mapping from `RepositoryId` to a registered
 * adapter plus its resolved `FusionWeight` and dispatch eligibility. It is the
 * single indirection between the federation service and the concrete adapters:
 * the federation layer resolves every adapter through this registry and never
 * names a concrete RepositoryId (design.md §1 Adapter Registry, Req 1.5).
 *
 * This module defines the registry contract (`FusionWeight`,
 * `IneligibilityReason`, `RegisteredAdapter`, `AdapterRegistration`,
 * `AdapterRegistry`, `RegistryBuildResult`, `RegistryFatalError`) and the
 * immutable construction path `createAdapterRegistry`. The registry is built
 * once at startup from an already-resolved set of registered adapters and is
 * immutable thereafter: `registeredIds` / `eligibleIds` return defensively
 * frozen snapshots, and `get` returns a frozen `RegisteredAdapter` so no caller
 * can mutate the mapping after construction (Req 1.1, 1.3).
 *
 * The ordered fatal-error checks (weight validation, max-count enforcement,
 * duplicate detection, schema validation, the all-fail check, and the
 * cursor-size bound) live in `buildRegistry`, which runs them in that exact
 * order, resolves each adapter's weight and dispatch eligibility, and hands the
 * resulting `RegisteredAdapter` set to `createAdapterRegistry` for the immutable
 * snapshot. Any condition that must terminate the process is returned as a
 * `RegistryFatalError` rather than thrown.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.8, 8.7, 10.1, 10.2
 */

import {
  CURSOR_V2_VERSION,
  MAX_ENCODED_CURSOR_BYTES,
  MAX_REPOSITORY_OFFSET,
  encodeCursorV2,
} from "../federation/cursor";
import type { FederationLimits, FusionWeight } from "../federation/limits";
import type { RepositoryId } from "../models/index";
import type { RepositoryAdapter } from "./index";

/**
 * A positive reciprocal-rank weight, validated to 0.01–100.0 inclusive by
 * `buildRegistry` (task 8.2). An absent weight defaults to `1.0` (equal
 * weighting) at registration time (Req 1.6).
 *
 * The canonical `FusionWeight` type lives in the shared federation limits
 * module; it is re-exported here so existing importers of `registry.ts` keep
 * working against a single definition.
 */
export type { FusionWeight };

// The fusion-weight bound constants keep their canonical home here because
// `buildRegistry` is the operational guard that validates against them.

/** Fusion weight assumed for a registration that omits one (Req 1.6). */
export const DEFAULT_FUSION_WEIGHT: FusionWeight = 1.0;

/** Smallest valid fusion weight, inclusive (Req 1.6, 10.2). */
export const MIN_FUSION_WEIGHT: FusionWeight = 0.01;

/** Largest valid fusion weight, inclusive (Req 1.6, 10.2). */
export const MAX_FUSION_WEIGHT: FusionWeight = 100.0;

/**
 * The shared `FederationLimits` model (`src/federation/limits.ts`) is the single
 * source of truth for the tuning envelope (`maxAdapters` 2–16 default 8, `rrfK`,
 * `canonicalizationBudget`, `deadlineMs`). `buildRegistry` only reads
 * `maxAdapters`, but it accepts the full shared type so there is one definition
 * across the federation layer. Re-exported here for existing importers.
 */
export type { FederationLimits };

/** Why an adapter is not eligible for dispatch, for diagnostics only. */
export type IneligibilityReason = "schema_validation_failed";

/**
 * A single registered adapter: the adapter itself, its resolved fusion weight,
 * and whether its startup schema validation succeeded (dispatch eligibility).
 */
export interface RegisteredAdapter {
  readonly adapter: RepositoryAdapter;
  readonly weight: FusionWeight;
  readonly eligible: boolean;
  readonly ineligibleReason: IneligibilityReason | null;
}

/**
 * An adapter presented for registration. The optional `weight` defaults to
 * `1.0` (equal weighting) when omitted (Req 1.6).
 */
export interface AdapterRegistration {
  readonly adapter: RepositoryAdapter;
  /** Omitted weight defaults to 1.0 (equal weighting). */
  readonly weight?: FusionWeight;
}

/**
 * Immutable startup registry of repository adapters.
 *
 * Constructed once at startup and never mutated thereafter; every accessor is a
 * pure read over the frozen internal mapping (Req 1.1, 1.3).
 */
export interface AdapterRegistry {
  /** All registered ids, lexicographically sorted, for enum + cursor + discovery. */
  registeredIds(): readonly RepositoryId[];
  /** Ids whose startup schema validation succeeded (dispatch-eligible). */
  eligibleIds(): readonly RepositoryId[];
  /** Whether an id is present in the registry. */
  has(id: RepositoryId): boolean;
  /** The registered adapter for an id, or `undefined` when not registered. */
  get(id: RepositoryId): RegisteredAdapter | undefined;
  /** The resolved fusion weight for an id; `1.0` when the id is not registered. */
  weightOf(id: RepositoryId): FusionWeight;
}

/** Outcome of `buildRegistry` (task 8.2): a registry plus any fatal error. */
export interface RegistryBuildResult {
  readonly registry: AdapterRegistry;
  /** Non-null when the process must terminate with a non-zero exit code. */
  readonly fatalError: RegistryFatalError | null;
}

/** Machine-readable reason the registry could not be built (task 8.2). */
export type RegistryFatalErrorCode =
  | "duplicate_repository_id"
  | "no_adapter_registered"
  | "all_adapters_schema_invalid"
  | "weight_out_of_range"
  | "adapter_count_exceeds_max"
  | "cursor_size_bound_exceeded";

/** A condition that must terminate the process with a non-zero exit code. */
export interface RegistryFatalError {
  readonly code: RegistryFatalErrorCode;
  readonly message: string;
}

/**
 * Build an immutable `AdapterRegistry` from an already-resolved set of
 * registered adapters.
 *
 * This is the construction path `buildRegistry` (task 8.2) uses once it has run
 * the ordered fatal-error checks and resolved each adapter's weight and
 * eligibility. It does not validate weights, detect duplicates, or run schema
 * checks — those are the caller's responsibility; it only snapshots the mapping
 * into a frozen, lexicographically-ordered structure.
 *
 * The returned registry is immutable: the internal map is cloned, the id lists
 * are frozen, and `get` hands back a frozen `RegisteredAdapter`, so no caller can
 * alter the registry after startup (Req 1.1, 1.3). `registeredIds` and
 * `eligibleIds` are precomputed once and returned as the same frozen arrays on
 * every call (Req 1.1).
 *
 * @throws when two registrations share a `RepositoryId`. Duplicate detection is
 *   a `buildRegistry` fatal-error concern (task 8.2); this guard only protects
 *   the invariant that a registry maps each id exactly once.
 */
export function createAdapterRegistry(registered: readonly RegisteredAdapter[]): AdapterRegistry {
  const byId = new Map<RepositoryId, RegisteredAdapter>();
  for (const entry of registered) {
    const id = entry.adapter.id;
    if (byId.has(id)) {
      throw new Error(`Duplicate repository id in registry construction: ${id}`);
    }
    byId.set(id, Object.freeze({ ...entry }));
  }

  const registeredIds = Object.freeze(
    Array.from(byId.keys()).sort(compareRepositoryId),
  ) as readonly RepositoryId[];

  const eligibleIds = Object.freeze(
    registeredIds.filter((id) => byId.get(id)?.eligible === true),
  ) as readonly RepositoryId[];

  return Object.freeze({
    registeredIds(): readonly RepositoryId[] {
      return registeredIds;
    },
    eligibleIds(): readonly RepositoryId[] {
      return eligibleIds;
    },
    has(id: RepositoryId): boolean {
      return byId.has(id);
    },
    get(id: RepositoryId): RegisteredAdapter | undefined {
      return byId.get(id);
    },
    weightOf(id: RepositoryId): FusionWeight {
      return byId.get(id)?.weight ?? DEFAULT_FUSION_WEIGHT;
    },
  });
}

/**
 * Build an immutable `AdapterRegistry` from the adapters presented at startup,
 * applying the ordered fatal-error checks (design.md §1, "Startup and Readiness").
 *
 * The checks run in exactly this order so the earliest-detectable misconfiguration
 * is the one reported, and each returns a `RegistryFatalError` that the caller
 * turns into a non-zero process exit / failed readiness probe:
 *
 *  1. Weight validation — every explicit weight must be finite and within
 *     0.01–100.0 inclusive (`weight_out_of_range`, Req 1.6, 10.2).
 *  2. Max-count enforcement — the registered count must not exceed
 *     `limits.maxAdapters` (`adapter_count_exceeds_max`, Req 10.1).
 *  3. Duplicate-id detection — no two registrations may share a `RepositoryId`
 *     (`duplicate_repository_id`, Req 1.2).
 *  4. Per-adapter `validateSchema` — each adapter's startup schema probe decides
 *     its dispatch eligibility; a failing adapter is excluded (`eligible=false`,
 *     `ineligibleReason='schema_validation_failed'`) but does not block the
 *     others (Req 1.4, 8.7).
 *  5. All-fail check — at least one adapter must be registered
 *     (`no_adapter_registered`, Req 1.2) and at least one must be schema-eligible
 *     (`all_adapters_schema_invalid`, Req 1.4).
 *  6. Cursor-size bound — the registered id set must not be able to produce a
 *     cursor exceeding `MAX_ENCODED_CURSOR_BYTES` (`cursor_size_bound_exceeded`,
 *     Req 3.8).
 *
 * On any fatal error, the returned `registry` is an empty, immutable registry and
 * `fatalError` is non-null. On success, `fatalError` is `null` and the registry
 * contains every registered adapter, with schema-failing ones present but
 * ineligible (Req 1.1, 1.3).
 */
export async function buildRegistry(
  registrations: readonly AdapterRegistration[],
  limits: Pick<FederationLimits, "maxAdapters">,
): Promise<RegistryBuildResult> {
  // 1. Weight validation (0.01–100.0 inclusive).
  for (const registration of registrations) {
    const weight = registration.weight;
    if (weight !== undefined && !isWeightInRange(weight)) {
      return fatal("weight_out_of_range", {
        repository: registration.adapter.id,
        weight,
        min: MIN_FUSION_WEIGHT,
        max: MAX_FUSION_WEIGHT,
      });
    }
  }

  // 2. Max-count enforcement.
  if (registrations.length > limits.maxAdapters) {
    return fatal("adapter_count_exceeds_max", {
      registered: registrations.length,
      maxAdapters: limits.maxAdapters,
    });
  }

  // 3. Duplicate-id detection.
  const seenIds = new Set<RepositoryId>();
  for (const registration of registrations) {
    const id = registration.adapter.id;
    if (seenIds.has(id)) {
      return fatal("duplicate_repository_id", { repository: id });
    }
    seenIds.add(id);
  }

  // 4. Per-adapter schema validation decides dispatch eligibility; a failing
  //    adapter is excluded but does not block the others.
  const schemaResults = await Promise.all(
    registrations.map((registration) => validateAdapterSchema(registration.adapter)),
  );
  const registered: RegisteredAdapter[] = registrations.map((registration, index) => {
    const eligible = schemaResults[index];
    return {
      adapter: registration.adapter,
      weight: registration.weight ?? DEFAULT_FUSION_WEIGHT,
      eligible,
      ineligibleReason: eligible ? null : "schema_validation_failed",
    };
  });

  // 5. All-fail check: at least one registered, at least one schema-eligible.
  if (registered.length === 0) {
    return fatal("no_adapter_registered", {});
  }
  if (!registered.some((entry) => entry.eligible)) {
    return fatal("all_adapters_schema_invalid", {
      registered: registered.length,
    });
  }

  // 6. Cursor-size bound: the registered id set must not be able to produce a
  //    cursor exceeding the encoded-size limit.
  const worstCaseCursorBytes = estimateWorstCaseCursorBytes(
    registered.map((entry) => entry.adapter.id),
  );
  if (worstCaseCursorBytes > MAX_ENCODED_CURSOR_BYTES) {
    return fatal("cursor_size_bound_exceeded", {
      registered: registered.length,
      worstCaseCursorBytes,
      maxEncodedCursorBytes: MAX_ENCODED_CURSOR_BYTES,
    });
  }

  return {
    registry: createAdapterRegistry(registered),
    fatalError: null,
  };
}

/** Whether `weight` is finite and within the inclusive 0.01–100.0 bound (Req 1.6, 10.2). */
function isWeightInRange(weight: FusionWeight): boolean {
  return Number.isFinite(weight) && weight >= MIN_FUSION_WEIGHT && weight <= MAX_FUSION_WEIGHT;
}

/**
 * Run an adapter's startup schema probe and reduce it to dispatch eligibility.
 *
 * A thrown probe (backend unreachable at startup) is treated as a failed
 * validation so the adapter is excluded rather than blocking the registry — the
 * fail-closed startup contract (Req 1.4, 8.7).
 */
async function validateAdapterSchema(adapter: RepositoryAdapter): Promise<boolean> {
  try {
    const result = await adapter.validateSchema();
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Estimate the worst-case encoded cursor size for a registered id set by encoding
 * a synthetic cursor that maximizes every size-contributing field: a full
 * 16-hex query hash, every id participating, every offset at its maximum
 * (`MAX_REPOSITORY_OFFSET`), and the largest tie-sequence index. Reusing the real
 * `encodeCursorV2` keeps the estimate faithful to production encoding rather than
 * a hand-rolled byte count (design.md §1, cursor-size bound).
 *
 * `encodeCursorV2` enforces the same `MAX_ENCODED_CURSOR_BYTES` guard and throws
 * once an encoded cursor would exceed it. A worst-case estimate that trips that
 * guard is precisely the breach `buildRegistry` must report, so the throw is
 * caught and reported as a byte count one past the limit — keeping the terminal
 * condition a returned `RegistryFatalError` rather than a thrown error, per the
 * `buildRegistry` contract (Req 3.8).
 */
function estimateWorstCaseCursorBytes(ids: readonly RepositoryId[]): number {
  try {
    const encoded = encodeCursorV2({
      v: CURSOR_V2_VERSION,
      // Maximal 16-char lowercase-hex query hash (FNV-1a 64-bit, Req 3.9).
      queryHash: "ffffffffffffffff",
      offsets: ids.map((id) => [id, MAX_REPOSITORY_OFFSET] as const),
      participating: [...ids],
      // Worst-case tie index is one short of the participating count.
      nextTieSequence: Math.max(0, ids.length - 1),
    });
    return Buffer.byteLength(encoded, "utf8");
  } catch {
    // The encoder's own size guard fired: the worst-case cursor is over the
    // limit. Report one byte past the limit so the caller's `>` comparison
    // reports the breach deterministically.
    return MAX_ENCODED_CURSOR_BYTES + 1;
  }
}

/** Construct a `RegistryBuildResult` carrying a fatal error and an empty registry. */
function fatal(
  code: RegistryFatalErrorCode,
  detail: Readonly<Record<string, unknown>>,
): RegistryBuildResult {
  return {
    registry: createAdapterRegistry([]),
    fatalError: { code, message: fatalMessage(code, detail) },
  };
}

/** Human-readable, non-sensitive message for each fatal-error code. */
function fatalMessage(
  code: RegistryFatalErrorCode,
  detail: Readonly<Record<string, unknown>>,
): string {
  switch (code) {
    case "weight_out_of_range":
      return (
        `Fusion weight ${String(detail.weight)} for repository ` +
        `${String(detail.repository)} is outside the allowed range ` +
        `${String(detail.min)}–${String(detail.max)}.`
      );
    case "adapter_count_exceeds_max":
      return (
        `Registered adapter count ${String(detail.registered)} exceeds the ` +
        `maximum of ${String(detail.maxAdapters)}.`
      );
    case "duplicate_repository_id":
      return `Repository id ${String(detail.repository)} is registered more than once.`;
    case "no_adapter_registered":
      return "No repository adapter is registered.";
    case "all_adapters_schema_invalid":
      return `All ${String(detail.registered)} registered adapters failed schema validation.`;
    case "cursor_size_bound_exceeded":
      return (
        `Registered adapter count ${String(detail.registered)} would produce a ` +
        `worst-case cursor of ${String(detail.worstCaseCursorBytes)} bytes, ` +
        `exceeding the ${String(detail.maxEncodedCursorBytes)}-byte limit.`
      );
  }
}

/** Lexicographic comparison of namespaced repository ids (design.md §1, §3). */
function compareRepositoryId(a: RepositoryId, b: RepositoryId): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
