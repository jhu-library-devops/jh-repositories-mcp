/**
 * Repository Adapters — Public Interface
 *
 * Exports the RepositoryAdapter contract that both platform adapters implement.
 * The federation and MCP layers depend only on this interface, never on
 * platform-specific internals.
 *
 * Requirements: 2, 3, 10.2
 */

import type {
  ItemDetail,
  RelatedRequest,
  RepositoryFacetRequest,
  RepositoryFacets,
  RepositoryId,
  RepositoryIdentifier,
  RepositoryPage,
  RepositorySearchRequest,
  SchemaValidationResult,
} from "../models/index";

/**
 * Contract for a repository adapter.
 *
 * Each adapter encapsulates all platform-specific knowledge: field mappings,
 * URL construction, public-access gate logic, and canonical API interaction.
 * The federation and MCP layers cannot name a Solr field, construct a repository
 * URL, or decide whether a platform record is public.
 */
export interface RepositoryAdapter {
  readonly id: RepositoryId;

  /**
   * Validate that the Solr schema contains the required fields at startup.
   * Fails readiness when required fields are missing.
   */
  validateSchema(): Promise<SchemaValidationResult>;

  /**
   * Search the repository's Solr index and validate candidates through
   * the canonical API before returning results.
   */
  search(request: RepositorySearchRequest): Promise<RepositoryPage>;

  /**
   * Resolve a single record by identifier through the canonical API.
   * Returns null for nonexistent or non-public records (indistinguishable).
   */
  get(identifier: RepositoryIdentifier): Promise<ItemDetail | null>;

  /**
   * Retrieve facet counts for the given query and filters.
   */
  facets(request: RepositoryFacetRequest): Promise<RepositoryFacets>;

  /**
   * Find records related to a source item within this repository.
   */
  related(source: ItemDetail, request: RelatedRequest): Promise<RepositoryPage>;
}
