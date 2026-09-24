/**
 * JHRDR Adapter — Module Entry
 *
 * Implements the RepositoryAdapter contract for JHRDR (Dataverse): candidate
 * search against the private Solr `collection1` through the safe query layer,
 * bounded rank-ordered canonicalization through the Dataverse Native API
 * client, allowlisted facets, and metadata-based related discovery (Dataverse
 * has no MoreLikeThis configuration).
 *
 * All Dataverse-specific knowledge (Solr fields, metadata blocks, Native API
 * interaction, publication-status gate logic) is encapsulated here. No Solr
 * field names, Dataverse URLs, or platform-specific logic may leak from this
 * module into federation, MCP, or model layers.
 *
 * Requirements: 3, 6, 7, 9, 10.2, 11.7-11.9, 14.6, 17.2
 */

import { jhrdrProfile as jhrdrProfileLiteral } from "../../../config/repositories/jhrdr-profile";
import type { RepositoryProfile } from "../../../config/repositories/jscholarship-profile";
import type {
  CommonFacet,
  FacetResult,
  ItemDetail,
  RelatedRequest,
  RepositoryFacetRequest,
  RepositoryFacets,
  RepositoryIdentifier,
  RepositoryPage,
  RepositoryRecord,
  RepositorySearchRequest,
  RepositoryWarning,
  SchemaValidationResult,
} from "../../models/index";
import { parseRecordId } from "../../models/index";
import { canonicalizeInOrder } from "../canonicalize";
import type { RepositoryAdapter } from "../index";
import { SolrClient } from "../solr-client";
import { buildFacetQuery, buildSearchQuery } from "../solr-query";
import { type FetchFn, validateSolrSchema } from "../solr-schema-validator";
import { DataverseClient, DataverseRequestError, normalizePersistentId } from "./dataverse-client";

const jhrdrProfile: RepositoryProfile = jhrdrProfileLiteral;

/** Bound on the metadata-derived related-search query text (Requirement 10.6). */
const MAX_RELATED_QUERY_LENGTH = 400;

/**
 * Options for constructing a JhrdrAdapter.
 */
export interface JhrdrAdapterOptions {
  /** Full URL to the Solr collection (e.g. http://solr.dataverse-stage.internal:8983/solr/collection1). */
  solrCollectionUrl: string;
  /** Private Dataverse Native API base (e.g. http://dataverse.internal:8080/api). */
  dataverseApiUrl: string;
  /** Public JHRDR base for landing-page and download URLs. */
  publicBaseUrl: string;
  /** Timeout for schema validation requests in ms. */
  schemaTimeoutMs?: number;
  /** Timeout for Solr and Native API requests in ms. */
  requestTimeoutMs?: number;
  /** Maximum concurrent canonical validations (fixed worker window). */
  canonicalConcurrency?: number;
  /** Injectable fetch for testing. */
  fetchFn?: FetchFn;
}

interface SolrDatasetDoc {
  readonly persistentId: string;
}

interface SolrSearchBody {
  response?: { numFound?: number; docs?: unknown[] };
  facet_counts?: { facet_fields?: Record<string, unknown[]> };
}

/**
 * JHRDR (Dataverse) adapter.
 */
export class JhrdrAdapter implements RepositoryAdapter {
  readonly id = "jhrdr" as const;

  private readonly solrCollectionUrl: string;
  private readonly schemaTimeoutMs: number;
  private readonly canonicalConcurrency: number;
  private readonly fetchFn: FetchFn;
  private readonly solr: SolrClient;
  private readonly dataverse: DataverseClient;

  constructor(options: JhrdrAdapterOptions) {
    this.solrCollectionUrl = options.solrCollectionUrl;
    this.schemaTimeoutMs = options.schemaTimeoutMs ?? 5000;
    this.canonicalConcurrency = options.canonicalConcurrency ?? 4;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.solr = new SolrClient(new URL(options.solrCollectionUrl), {
      requestTimeoutMs,
      fetchImpl: (url, init) => this.fetchFn(url, init),
    });
    this.dataverse = new DataverseClient({
      apiBaseUrl: new URL(options.dataverseApiUrl),
      publicBaseUrl: new URL(options.publicBaseUrl),
      requestTimeoutMs,
      fetchImpl: (url, init) => this.fetchFn(url, init),
    });
  }

  async validateSchema(): Promise<SchemaValidationResult> {
    const schemaUrl = `${this.solrCollectionUrl}/schema`;
    return validateSolrSchema({
      schemaUrl,
      profile: jhrdrProfile,
      timeoutMs: this.schemaTimeoutMs,
      fetchFn: this.fetchFn,
    });
  }

  /**
   * Candidate search + bounded canonicalization (tasks 9.1-9.2). Mirrors the
   * JScholarship adapter's cursor arithmetic: nextOffset = startOffset +
   * candidatesConsumed; null only when Solr returned fewer candidates than
   * requested.
   */
  async search(request: RepositorySearchRequest): Promise<RepositoryPage> {
    const { query, unsupportedFilters } = buildSearchQuery(jhrdrProfile, request);
    const body = (await this.solr.execute(query)) as SolrSearchBody;
    const docs = parseDocs(body);
    const rowsRequested = Number(query.params.get("rows"));

    const { records, consumed, omissions } = await this.canonicalize(
      docs,
      request.limit,
      request.offset,
    );

    const windowExhausted = docs.length < rowsRequested;
    const warnings: RepositoryWarning[] = unsupportedFilters.map((concept) => ({
      repository: this.id,
      code: "unsupported_filter",
      message: `Filter "${concept}" is not supported by JHRDR and was not applied.`,
    }));
    if (
      records.length < request.limit &&
      omissions > 0 &&
      !(windowExhausted && consumed === docs.length)
    ) {
      warnings.push({
        repository: this.id,
        code: "validation_attrition",
        message:
          "Some matching datasets could not be validated as public within this page's candidate window; more results may exist on the next page.",
      });
    }

    return {
      repository: this.id,
      results: records,
      nextOffset: windowExhausted && consumed === docs.length ? null : request.offset + consumed,
      totalCandidates: typeof body.response?.numFound === "number" ? body.response.numFound : 0,
      validationOmissions: omissions,
      warnings,
    };
  }

  async probePublic(record: RepositoryRecord): Promise<boolean> {
    return this.dataverse.probeDatasetPublic(record.provenance.platformRecordId);
  }

  async get(identifier: RepositoryIdentifier): Promise<ItemDetail | null> {
    const persistentId = this.toPersistentId(identifier);
    if (persistentId === null) {
      return null;
    }
    return this.dataverse.resolveDataset(persistentId, { expandFiles: true });
  }

  async facets(request: RepositoryFacetRequest): Promise<RepositoryFacets> {
    const supported: CommonFacet[] = [];
    const warnings: RepositoryWarning[] = [];
    for (const concept of request.facets) {
      if (concept === "repository" || jhrdrProfile.facetFields[concept] === undefined) {
        if (concept !== "repository") {
          warnings.push({
            repository: this.id,
            code: "unsupported_filter",
            message: `Facet "${concept}" is not supported by JHRDR.`,
          });
        }
        continue;
      }
      supported.push(concept);
    }
    // Queried even when only the synthesized `repository` facet was asked
    // for: its count is this repository's match total.
    const query = buildFacetQuery(jhrdrProfile, {
      query: request.query,
      field: request.field,
      filters: request.filters,
      facets: supported,
      limit: request.limit,
      offset: request.offset,
    });
    const body = (await this.solr.execute(query)) as SolrSearchBody;
    const facetFields = body.facet_counts?.facet_fields ?? {};
    const totalMatches =
      typeof body.response?.numFound === "number" ? Math.max(0, body.response.numFound) : 0;

    const facets: FacetResult[] = [];
    for (const concept of supported) {
      const solrField = jhrdrProfile.facetFields[concept];
      if (solrField === undefined) {
        continue;
      }
      facets.push({ facet: concept, values: parseFacetPairs(facetFields[solrField]) });
    }
    return { repository: this.id, facets, totalMatches, warnings };
  }

  /**
   * Metadata-based related discovery (task 9.3): Dataverse has no
   * MoreLikeThis, so a bounded keyword query is derived from the source's
   * public canonical metadata (title, creators, subjects) only.
   */
  async related(source: ItemDetail, request: RelatedRequest): Promise<RepositoryPage> {
    const sourcePersistentId = source.provenance.platformRecordId;
    const terms = [source.title, ...source.creators.map((c) => c.name), ...source.subjects]
      .join(" ")
      .slice(0, MAX_RELATED_QUERY_LENGTH)
      .trim();
    if (terms.length === 0) {
      return {
        repository: this.id,
        results: [],
        nextOffset: null,
        totalCandidates: 0,
        validationOmissions: 0,
        warnings: [],
      };
    }

    const { query } = buildSearchQuery(jhrdrProfile, {
      query: terms,
      field: "keyword",
      limit: request.limit,
      offset: 0,
    });
    const body = (await this.solr.execute(query)) as SolrSearchBody;
    const docs = parseDocs(body).filter((doc) => doc.persistentId !== sourcePersistentId);

    const { records, omissions } = await this.canonicalize(docs, request.limit, 0);
    return {
      repository: this.id,
      results: records,
      nextOffset: null,
      totalCandidates: docs.length,
      validationOmissions: omissions,
      warnings: [],
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private canonicalize(
    docs: SolrDatasetDoc[],
    limit: number,
    startOffset: number,
  ): ReturnType<typeof canonicalizeInOrder<SolrDatasetDoc>> {
    return canonicalizeInOrder({
      candidates: docs,
      limit,
      startOffset,
      concurrency: this.canonicalConcurrency,
      resolve: (doc) =>
        this.dataverse.resolveDataset(doc.persistentId, { expandFiles: false }).catch((cause) => {
          if (cause instanceof DataverseRequestError) {
            return null;
          }
          throw cause;
        }),
    });
  }

  private toPersistentId(identifier: RepositoryIdentifier): string | null {
    if (identifier.repository !== this.id) {
      return null;
    }
    switch (identifier.type) {
      case "doi":
      case "handle":
      case "persistent_id":
        return normalizePersistentId(identifier.value);
      case "namespaced": {
        const parsed = parseRecordId(identifier.value);
        if (parsed === null || parsed.repository !== this.id) {
          return null;
        }
        return normalizePersistentId(parsed.platformId);
      }
      default:
        return null;
    }
  }
}

// ─── Response parsing ────────────────────────────────────────────────────────

function parseDocs(body: SolrSearchBody): SolrDatasetDoc[] {
  const rawDocs = Array.isArray(body.response?.docs) ? body.response.docs : [];
  const docs: SolrDatasetDoc[] = [];
  for (const raw of rawDocs) {
    const doc = raw as Record<string, unknown>;
    const persistentId = doc[jhrdrProfile.identityFields.handle];
    if (typeof persistentId !== "string" || persistentId.length === 0) {
      continue;
    }
    docs.push({ persistentId });
  }
  return docs;
}

function parseFacetPairs(pairs: unknown): FacetResult["values"] {
  if (!Array.isArray(pairs)) {
    return [];
  }
  const values: FacetResult["values"] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const label = pairs[i];
    const count = pairs[i + 1];
    if (typeof label === "string" && typeof count === "number") {
      values.push({ label, count, repositoryBreakdown: { jhrdr: count } });
    }
  }
  return values;
}
