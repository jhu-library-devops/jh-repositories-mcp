/**
 * Repository Adapters — Public Interface (Contract v2)
 *
 * Exports the versioned `RepositoryAdapter` contract that every platform adapter
 * implements. The federation and MCP layers depend only on this interface, never
 * on platform-specific internals: adapter input/output types carry no Solr field
 * names, repository-specific URLs, or platform API structures, and no adapter
 * references another adapter or the federation merge logic.
 *
 * The contract is pinned by `ADAPTER_CONTRACT_VERSION` so a breaking change to the
 * surface is a compile-time error rather than a runtime failure.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9
 */

import type {
  ItemDetail,
  RelatedRequest,
  RepositoryFacetRequest,
  RepositoryFacets,
  RepositoryId,
  RepositoryIdentifier,
  RepositoryPage,
  RepositoryRecord,
  RepositorySearchRequest,
  SchemaValidationResult,
} from "../models/index";

/**
 * `validateSchema` reports dispatch eligibility to the federation service via
 * `SchemaValidationResult`: a success/failure status (`valid`), the required
 * fields confirmed present in the deployed schema, and the required fields that
 * are missing. Re-exported here so the adapter contract surface is self-contained
 * (Req 8.9).
 */
export type { SchemaValidationResult } from "../models/index";

/**
 * Adapter Registry surface (design.md §1). Re-exported from the adapters seam so
 * the federation and MCP layers import the canonical `AdapterRegistry` and its
 * companion types from one place without reaching into the registry module. The
 * registry is constructed once at startup and immutable thereafter (Req 1.1,
 * 1.3, 1.5, 1.6).
 */
export {
  buildRegistry,
  createAdapterRegistry,
  DEFAULT_FUSION_WEIGHT,
  MAX_FUSION_WEIGHT,
  MIN_FUSION_WEIGHT,
} from "./registry";
export type {
  AdapterRegistration,
  AdapterRegistry,
  FederationLimits,
  FusionWeight,
  IneligibilityReason,
  RegisteredAdapter,
  RegistryBuildResult,
  RegistryFatalError,
  RegistryFatalErrorCode,
} from "./registry";

/**
 * Contract version implemented by this adapter surface. Bump on any breaking
 * change to the `RepositoryAdapter` contract so incompatible adapters fail to
 * compile rather than at runtime (Req 8.6).
 */
export const ADAPTER_CONTRACT_VERSION = 2 as const;

/**
 * Machine-readable code describing why an adapter operation failed. Carries no
 * internal endpoints, exception text, or stack traces (Req 8.8).
 */
export type AdapterFailureCode =
  | "backend_unavailable"
  | "backend_timeout"
  | "invalid_response"
  | "schema_invalid";

/**
 * Structured failure returned when a backend is unreachable or returns a
 * non-transient error during `search`, `get`, `facets`, or `related`. Identifies
 * the originating repository and a machine-readable code only — never internal
 * endpoints or exception details (Req 8.8).
 */
export interface AdapterFailure {
  readonly repository: RepositoryId;
  readonly code: AdapterFailureCode;
}

/** Per-call options for RepositoryAdapter.get. */
export interface GetOptions {
  /** Receives the backend fault behind a degraded (files-unavailable) record. */
  onDegraded?: (cause: unknown) => void;
}

/**
 * Contract for a repository adapter.
 *
 * Each adapter encapsulates all platform-specific knowledge: field mappings,
 * URL construction, public-access gate logic, and canonical API interaction.
 * The federation and MCP layers cannot name a Solr field, construct a repository
 * URL, or decide whether a platform record is public (Req 8.1, 8.4).
 *
 * No adapter imports, references, or receives another adapter or the federation
 * merge logic (Req 8.2).
 */
export interface RepositoryAdapter {
  readonly id: RepositoryId;

  /** Declares the contract version this adapter implements (Req 8.6). */
  readonly contractVersion: typeof ADAPTER_CONTRACT_VERSION;

  /**
   * Validate that the Solr schema contains the required fields at startup.
   * Returns a `SchemaValidationResult` so the federation service decides dispatch
   * eligibility without interpreting platform schema responses; a missing-required
   * result excludes the adapter (Req 8.7, 8.9).
   */
  validateSchema(): Promise<SchemaValidationResult>;

  /**
   * Search the repository's Solr index and validate candidates through
   * the canonical API before returning results. Performs its own public-access
   * validation; the federation service performs no access checks (Req 8.4).
   */
  search(request: RepositorySearchRequest): Promise<RepositoryPage>;

  /**
   * Resolve a single record by identifier through the canonical API.
   * Returns null for nonexistent or non-public records (indistinguishable).
   * A record whose file listing could not be retrieved is still returned,
   * with `filesStatus: "unavailable"`; the cause goes to `onDegraded`.
   */
  get(identifier: RepositoryIdentifier, options?: GetOptions): Promise<ItemDetail | null>;

  /**
   * Retrieve facet counts for the given query and filters.
   */
  facets(request: RepositoryFacetRequest): Promise<RepositoryFacets>;

  /**
   * Find records related to a source item within this repository. Performs its
   * own public-access validation (Req 8.4).
   */
  related(source: ItemDetail, request: RelatedRequest): Promise<RepositoryPage>;

  /**
   * Lightweight platform-specific revalidation probe: is this record still
   * anonymously retrievable and public? Used before emitting cached records.
   * Throws on backend faults so cache layers fail closed. Promoted from optional
   * (v1) to required in contract version 2 (Req 8.5).
   */
  probePublic(record: RepositoryRecord): Promise<boolean>;
}
