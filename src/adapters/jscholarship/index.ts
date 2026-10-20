/**
 * JScholarship Adapter — Module Entry
 *
 * Implements the RepositoryAdapter contract for JScholarship (DSpace):
 * candidate search against the private Solr `search` collection through the
 * safe query layer, bounded rank-ordered canonicalization through the DSpace
 * REST client, allowlisted facets, and MoreLikeThis related discovery.
 *
 * All DSpace-specific knowledge (Solr fields, Discovery configuration, REST
 * interaction, public-access gate logic) is encapsulated here. No Solr field
 * names, DSpace URLs, or platform-specific logic may leak from this module
 * into federation, MCP, or model layers.
 *
 * Requirements: 2, 6, 7, 9, 10.2, 11.7-11.9, 14.6
 */

import {
  type RepositoryProfile,
  jscholarshipProfile as jscholarshipProfileLiteral,
} from "../../../config/repositories/jscholarship-profile";

const jscholarshipProfile: RepositoryProfile = jscholarshipProfileLiteral;
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
import type { GetOptions, RepositoryAdapter } from "../index";
import { SolrClient } from "../solr-client";
import { buildFacetQuery, buildRelatedQuery, buildSearchQuery } from "../solr-query";
import { type FetchFn, validateSolrSchema } from "../solr-schema-validator";
import { DSpaceClient, DSpaceRequestError } from "./dspace-client";

/**
 * Options for constructing a JScholarshipAdapter.
 */
export interface JScholarshipAdapterOptions {
  /** Full URL to the Solr collection (e.g. http://solr.dspace-stage.local:8983/solr/search). */
  solrCollectionUrl: string;
  /** Private DSpace REST API base (e.g. http://dspace.internal:8080/server/api). */
  dspaceApiUrl: string;
  /** Public JScholarship base for landing-page and download URLs. */
  publicBaseUrl: string;
  /** Timeout for schema validation requests in ms. */
  schemaTimeoutMs?: number;
  /** Timeout for Solr and DSpace REST requests in ms. */
  requestTimeoutMs?: number;
  /** Maximum concurrent canonical validations (fixed worker window). */
  canonicalConcurrency?: number;
  /** Injectable fetch for testing. */
  fetchFn?: FetchFn;
}

interface SolrDoc {
  readonly uuid: string;
  readonly handle: string | null;
}

interface SolrSearchBody {
  response?: { numFound?: number; docs?: unknown[] };
  facet_counts?: { facet_fields?: Record<string, unknown[]> };
  /** MoreLikeThis component output, keyed by source document. */
  moreLikeThis?: unknown;
}

/**
 * JScholarship (DSpace) adapter.
 */
export class JScholarshipAdapter implements RepositoryAdapter {
  readonly id = "jscholarship" as const;

  private readonly solrCollectionUrl: string;
  private readonly schemaTimeoutMs: number;
  private readonly canonicalConcurrency: number;
  private readonly fetchFn: FetchFn;
  private readonly solr: SolrClient;
  private readonly dspace: DSpaceClient;

  constructor(options: JScholarshipAdapterOptions) {
    this.solrCollectionUrl = options.solrCollectionUrl;
    this.schemaTimeoutMs = options.schemaTimeoutMs ?? 5000;
    this.canonicalConcurrency = options.canonicalConcurrency ?? 4;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.solr = new SolrClient(new URL(options.solrCollectionUrl), {
      requestTimeoutMs,
      fetchImpl: (url, init) => this.fetchFn(url, init),
    });
    this.dspace = new DSpaceClient({
      apiBaseUrl: new URL(options.dspaceApiUrl),
      publicBaseUrl: new URL(options.publicBaseUrl),
      requestTimeoutMs,
      fetchImpl: (url, init) => this.fetchFn(url, init),
    });
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

  /**
   * Candidate search + bounded canonicalization (tasks 7.1-7.2).
   *
   * Solr supplies a 3×limit candidate window; each candidate is validated in
   * rank order through DSpace REST with a fixed concurrency window. Cursor
   * arithmetic: nextOffset = startOffset + candidatesConsumed, where consumed
   * counts passed, failed, and timed-out candidates; null only when Solr
   * returned fewer candidates than requested (the result set is exhausted).
   */
  async search(request: RepositorySearchRequest): Promise<RepositoryPage> {
    const { query, unsupportedFilters } = buildSearchQuery(jscholarshipProfile, request);
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
      message: `Filter "${concept}" is not supported by JScholarship and was not applied.`,
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
          "Some matching records could not be validated as public within this page's candidate window; more results may exist on the next page.",
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
    return this.dspace.probeItemPublic(record.provenance.platformRecordId);
  }

  async get(identifier: RepositoryIdentifier, options?: GetOptions): Promise<ItemDetail | null> {
    const resolved = this.toDspaceIdentifier(identifier);
    if (resolved === null) {
      return null;
    }
    return this.dspace.resolveItem(resolved, {
      expandFiles: true,
      onFilesFault: options?.onDegraded,
    });
  }

  async facets(request: RepositoryFacetRequest): Promise<RepositoryFacets> {
    const supported: CommonFacet[] = [];
    const warnings: RepositoryWarning[] = [];
    for (const concept of request.facets) {
      if (concept === "repository" || jscholarshipProfile.facetFields[concept] === undefined) {
        if (concept !== "repository") {
          warnings.push({
            repository: this.id,
            code: "unsupported_filter",
            message: `Facet "${concept}" is not supported by JScholarship.`,
          });
        }
        continue;
      }
      supported.push(concept);
    }
    // Queried even when only the synthesized `repository` facet was asked
    // for: its count is this repository's match total.
    const query = buildFacetQuery(jscholarshipProfile, {
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
      const solrField = jscholarshipProfile.facetFields[concept];
      if (solrField === undefined) {
        continue;
      }
      facets.push({ facet: concept, values: parseFacetPairs(facetFields[solrField]) });
    }
    return { repository: this.id, facets, totalMatches, warnings };
  }

  async related(source: ItemDetail, request: RelatedRequest): Promise<RepositoryPage> {
    const sourceUuid = source.provenance.platformRecordId;
    const query = buildRelatedQuery(jscholarshipProfile, {
      identityValue: sourceUuid,
      limit: request.limit,
    });
    const body = (await this.solr.execute(query)) as SolrSearchBody;
    const docs = parseMoreLikeThisDocs(body).filter((doc) => doc.uuid !== sourceUuid);

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
    docs: SolrDoc[],
    limit: number,
    startOffset: number,
  ): ReturnType<typeof canonicalizeInOrder<SolrDoc>> {
    return canonicalizeInOrder({
      candidates: docs,
      limit,
      startOffset,
      concurrency: this.canonicalConcurrency,
      resolve: (doc) =>
        this.dspace
          .resolveItem({ type: "uuid", value: doc.uuid }, { expandFiles: false })
          .catch((cause) => {
            if (cause instanceof DSpaceRequestError) {
              return null;
            }
            throw cause;
          }),
    });
  }

  private toDspaceIdentifier(
    identifier: RepositoryIdentifier,
  ): { type: "uuid" | "handle"; value: string } | null {
    if (identifier.repository !== this.id) {
      return null;
    }
    switch (identifier.type) {
      case "uuid":
        return { type: "uuid", value: identifier.value };
      case "handle":
        return { type: "handle", value: identifier.value };
      case "namespaced": {
        const parsed = parseRecordId(identifier.value);
        if (parsed === null || parsed.repository !== this.id) {
          return null;
        }
        return { type: "uuid", value: parsed.platformId };
      }
      default:
        return null;
    }
  }
}

// ─── Response parsing ────────────────────────────────────────────────────────

function parseDocs(body: SolrSearchBody): SolrDoc[] {
  const rawDocs = Array.isArray(body.response?.docs) ? body.response.docs : [];
  const docs: SolrDoc[] = [];
  for (const raw of rawDocs) {
    const doc = raw as Record<string, unknown>;
    const uuid = doc[jscholarshipProfile.identityFields.uuid];
    if (typeof uuid !== "string" || uuid.length === 0) {
      continue;
    }
    const handle = doc[jscholarshipProfile.identityFields.handle];
    docs.push({ uuid, handle: typeof handle === "string" ? handle : null });
  }
  return docs;
}

/**
 * Similar documents from the MoreLikeThis component. With `json.nl=map` the
 * section is an object keyed by the source document's unique key; a flat
 * `[key, value, ...]` list is accepted too in case a deployment overrides
 * `json.nl`. The main query matches one source, so every entry is read.
 */
function parseMoreLikeThisDocs(body: SolrSearchBody): SolrDoc[] {
  const section = body.moreLikeThis;
  let entries: unknown[] = [];
  if (Array.isArray(section)) {
    entries = section.filter((_, index) => index % 2 === 1);
  } else if (typeof section === "object" && section !== null) {
    entries = Object.values(section);
  }
  return entries.flatMap((entry) => {
    const docs = (entry as { docs?: unknown } | null)?.docs;
    return Array.isArray(docs) ? parseDocs({ response: { docs } }) : [];
  });
}

function parseFacetPairs(pairs: unknown): FacetResult["values"] {
  if (!Array.isArray(pairs)) {
    return [];
  }
  const values: FacetResult["values"] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const raw = pairs[i];
    const count = pairs[i + 1];
    if (typeof raw !== "string" || typeof count !== "number") {
      continue;
    }
    const label = decodeFacetLabel(raw);
    if (label.length > 0) {
      values.push({ label, count, repositoryBreakdown: { jscholarship: count } });
    }
  }
  return values;
}

/** DSpace's separator between the sort key and the display value in *_filter fields. */
const FILTER_SEPARATOR = "|||";
/** DSpace's separator before an authority key appended to the display value. */
const AUTHORITY_SEPARATOR = "###";

/**
 * Discovery indexes *_filter values as `lowercase\n|||\nDisplay value`,
 * with `###authority-key` appended for authority-controlled values. Only
 * the display value is a label; values without the separator (years,
 * collection IDs) pass through unchanged.
 */
export function decodeFacetLabel(raw: string): string {
  const separator = raw.lastIndexOf(FILTER_SEPARATOR);
  let display = separator === -1 ? raw : raw.slice(separator + FILTER_SEPARATOR.length);
  // Split at the last marker: authority keys (URIs, UUIDs) never contain it,
  // but a display value may end in "#" ("C#").
  const authority = display.lastIndexOf(AUTHORITY_SEPARATOR);
  if (authority !== -1) {
    display = display.slice(0, authority);
  }
  return display.trim();
}
