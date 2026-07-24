/**
 * JScholarship Adapter — Module Entry
 *
 * Stub implementation of the RepositoryAdapter interface for JScholarship (DSpace).
 * All DSpace-specific knowledge (Solr fields, Discovery configuration, REST API
 * interaction, public-access gate logic) is encapsulated here.
 *
 * No Solr field names, DSpace URLs, or platform-specific logic may leak from
 * this module into federation, MCP, or model layers.
 *
 * Requirements: 2, 9, 10.2
 */

import type { RepositoryAdapter } from "../index";
import type {
  ItemDetail,
  RelatedRequest,
  RepositoryFacetRequest,
  RepositoryFacets,
  RepositoryIdentifier,
  RepositoryPage,
  RepositorySearchRequest,
  SchemaValidationResult,
} from "../../models/index";
import { jscholarshipProfile } from "../../../config/repositories/jscholarship-profile";
import { validateSolrSchema, type FetchFn } from "../solr-schema-validator";

/**
 * Options for constructing a JScholarshipAdapter.
 */
export interface JScholarshipAdapterOptions {
  /** Full URL to the Solr collection (e.g. http://solr.dspace-stage.local:8983/solr/search). */
  solrCollectionUrl: string;
  /** Timeout for schema validation requests in ms. */
  schemaTimeoutMs?: number;
  /** Injectable fetch for testing. */
  fetchFn?: FetchFn;
}

/**
 * JScholarship (DSpace) adapter.
 *
 * Implements the RepositoryAdapter contract using:
 * - Private DSpace Solr `search` collection for candidate retrieval
 * - DSpace REST API for canonical public-access validation
 * - Discovery-generated field mappings from the JScholarship profile
 */
export class JScholarshipAdapter implements RepositoryAdapter {
  readonly id = "jscholarship" as const;

  private readonly solrCollectionUrl: string;
  private readonly schemaTimeoutMs: number;
  private readonly fetchFn: FetchFn;

  constructor(options: JScholarshipAdapterOptions) {
    this.solrCollectionUrl = options.solrCollectionUrl;
    this.schemaTimeoutMs = options.schemaTimeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async validateSchema(): Promise<SchemaValidationResult> {
    const schemaUrl = `${this.solrCollectionUrl}/schema`;
    return validateSolrSchema({
      schemaUrl,
      profile: jscholarshipProfile,
      timeoutMs: this.schemaTimeoutMs,
      fetchFn: this.fetchFn,
    });
  }

  async search(_request: RepositorySearchRequest): Promise<RepositoryPage> {
    // TODO: Implement candidate search + canonicalization (tasks 7.1, 7.2)
    return {
      repository: "jscholarship",
      results: [],
      nextOffset: null,
      totalCandidates: 0,
      validationOmissions: 0,
      warnings: [],
    };
  }

  async get(_identifier: RepositoryIdentifier): Promise<ItemDetail | null> {
    // TODO: Implement canonical item resolution (task 6.1)
    return null;
  }

  async facets(_request: RepositoryFacetRequest): Promise<RepositoryFacets> {
    // TODO: Implement facet retrieval (task 7.3)
    return {
      repository: "jscholarship",
      facets: [],
      warnings: [],
    };
  }

  async related(_source: ItemDetail, _request: RelatedRequest): Promise<RepositoryPage> {
    // TODO: Implement MoreLikeThis related search (task 7.3)
    return {
      repository: "jscholarship",
      results: [],
      nextOffset: null,
      totalCandidates: 0,
      validationOmissions: 0,
      warnings: [],
    };
  }
}
