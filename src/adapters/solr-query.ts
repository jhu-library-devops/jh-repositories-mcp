/**
 * Safe Solr Query Layer
 *
 * One generic, RepositoryProfile-parameterized query builder shared by both
 * adapters. Every value is escaped with a Lucene/Solr-safe encoder, every
 * field is resolved through the profile's allowlists, immutable public
 * filters are appended in a step no client input can reach, and every
 * request carries explicit fl, rows, start, sort, and timeAllowed bounds.
 *
 * Requirements: 1.4, 2.3, 3.3, 6.1-6.5, 7.2-7.4, 9.1-9.4, 10.1-10.7
 */

import type { RepositoryProfile, SolrSort } from "../../config/repositories/jscholarship-profile";
import type { CommonFacet, RepositorySearchRequest, SearchFilters } from "../models/index";

// ─── Bounds (Requirement 10.6) ───────────────────────────────────────────────

/** Over-fetch ceiling: rows = 3 × limit, and limit is clamped to 25 upstream. */
export const MAX_ROWS = 75;

/** Bounded result window: the deepest Solr start offset the MCP will request. */
export const MAX_START = 1000;

/** Upper bound for Solr's cooperative timeAllowed, in milliseconds. */
export const MAX_TIME_ALLOWED_MS = 10_000;

const DEFAULT_TIME_ALLOWED_MS = 5_000;

const FACET_VALUE_LIMIT = 10;

const MAX_FILTER_VALUES = 20;

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Thrown when a request cannot be translated safely; no backend I/O occurs. */
export class UnsafeQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeQueryError";
  }
}

// ─── Lucene/Solr value encoder (Requirement 10.3) ───────────────────────────

/**
 * Escapes every Lucene/Solr special character so user-supplied text can only
 * ever match as literal terms. Backslash is escaped first; `&&` and `||` are
 * escaped per character; `{` and `!` are covered so local-parameter syntax
 * (`{!func ...}`) cannot alter query structure.
 */
export function escapeSolrValue(value: string): string {
  return value.replace(/[\\+\-!(){}[\]^"~*?:/|&]/g, (char) => `\\${char}`);
}

/** ISO date (YYYY, YYYY-MM, or YYYY-MM-DD) — the only shapes accepted in ranges. */
const DATE_VALUE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

// ─── Shared query assembly ───────────────────────────────────────────────────

export interface SafeSolrQuery {
  readonly path: "/select" | "/mlt";
  readonly params: URLSearchParams;
  readonly expectedFields: ReadonlySet<string>;
}

export interface BuiltSearchQuery {
  readonly query: SafeSolrQuery;
  /** Filter concepts translated and applied for this repository. */
  readonly appliedFilters: readonly string[];
  /** Filter concepts this repository's profile cannot express (Requirement 1.4). */
  readonly unsupportedFilters: readonly string[];
}

/**
 * Appends the profile's immutable public filters. This step is called by
 * every builder in this module after client-derived parameters are set;
 * nothing in any request shape can remove, weaken, or replace these values.
 * (Requirements 2.3, 3.3, 9.1-9.2)
 */
function appendImmutablePublicFilters(params: URLSearchParams, profile: RepositoryProfile): void {
  for (const filter of profile.immutablePublicFilters) {
    params.append("fq", filter.fq);
  }
}

function boundedTimeAllowed(): string {
  return String(Math.min(DEFAULT_TIME_ALLOWED_MS, MAX_TIME_ALLOWED_MS));
}

function sortDirective(sort: SolrSort): string {
  return `${sort.field} ${sort.direction}`;
}

function quoteEscaped(value: string): string {
  return `"${escapeSolrValue(value)}"`;
}

// ─── Filter translation (Requirements 1.4, 10.2) ────────────────────────────

interface FilterTranslation {
  readonly applied: string[];
  readonly unsupported: string[];
  readonly fqs: string[];
}

const LIST_FILTER_CONCEPTS: ReadonlyArray<{
  requestKey: keyof SearchFilters;
  profileKey: string;
}> = [
  { requestKey: "creators", profileKey: "author" },
  { requestKey: "subjects", profileKey: "subject" },
  { requestKey: "resourceTypes", profileKey: "resourceType" },
  { requestKey: "collections", profileKey: "collection" },
];

function translateFilters(
  profile: RepositoryProfile,
  filters: SearchFilters | undefined,
): FilterTranslation {
  const applied: string[] = [];
  const unsupported: string[] = [];
  const fqs: string[] = [];
  if (!filters) {
    return { applied, unsupported, fqs };
  }

  for (const { requestKey, profileKey } of LIST_FILTER_CONCEPTS) {
    const values = filters[requestKey];
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    if (values.length > MAX_FILTER_VALUES) {
      throw new UnsafeQueryError(`Filter ${requestKey} exceeds ${MAX_FILTER_VALUES} values`);
    }
    const field = profile.filterFields[profileKey];
    if (!field) {
      unsupported.push(requestKey);
      continue;
    }
    const clause = values.map(quoteEscaped).join(" OR ");
    fqs.push(`${field}:(${clause})`);
    applied.push(requestKey);
  }

  if (filters.dateFrom !== undefined || filters.dateTo !== undefined) {
    const field = profile.filterFields.dateIssued;
    if (!field) {
      unsupported.push("date");
    } else {
      const from = validatedDateBound(filters.dateFrom, "dateFrom");
      const to = validatedDateBound(filters.dateTo, "dateTo");
      fqs.push(`${field}:[${from} TO ${to}]`);
      applied.push("date");
    }
  }

  if (filters.access !== undefined) {
    // Access-status value vocabularies are platform-specific and not yet
    // verified against either deployment; adapters own this translation
    // (tasks 7.x / 9.x). Reported as unsupported rather than guessed.
    unsupported.push("access");
  }

  return { applied, unsupported, fqs };
}

function validatedDateBound(value: string | undefined, label: "dateFrom" | "dateTo"): string {
  if (value === undefined) {
    return "*";
  }
  if (!DATE_VALUE.test(value)) {
    throw new UnsafeQueryError(`${label} must be an ISO date (YYYY, YYYY-MM, or YYYY-MM-DD)`);
  }
  return `"${value}"`;
}

// ─── Search (Requirements 1.1-1.5, 10.1-10.7) ───────────────────────────────

export function buildSearchQuery(
  profile: RepositoryProfile,
  request: RepositorySearchRequest,
): BuiltSearchQuery {
  const fieldConcept = request.field ?? "keyword";
  const weightedFields = profile.queryFields[fieldConcept];
  if (!weightedFields || weightedFields.length === 0) {
    throw new UnsafeQueryError(`Search field "${fieldConcept}" is not supported by ${profile.id}`);
  }

  if (!Number.isInteger(request.offset) || request.offset < 0) {
    throw new UnsafeQueryError("offset must be a non-negative integer");
  }
  if (request.offset > MAX_START) {
    throw new UnsafeQueryError(`offset exceeds the bounded window of ${MAX_START}`);
  }
  if (!Number.isInteger(request.limit) || request.limit < 1) {
    throw new UnsafeQueryError("limit must be a positive integer");
  }

  const rows = Math.min(request.limit * 3, MAX_ROWS);
  const params = new URLSearchParams();
  params.set("defType", "edismax");
  params.set("q", escapeSolrValue(request.query));
  params.set(
    "qf",
    weightedFields
      .map(({ field, boost }) => (boost === undefined ? field : `${field}^${boost}`))
      .join(" "),
  );

  const translation = translateFilters(profile, request.filters);
  for (const fq of translation.fqs) {
    params.append("fq", fq);
  }

  const sort = profile.sortFields[request.sort ?? "relevance"];
  if (!sort) {
    throw new UnsafeQueryError(`Sort "${request.sort}" is not supported by ${profile.id}`);
  }
  params.set("sort", sortDirective(sort));
  params.set("fl", profile.returnFields.join(","));
  params.set("rows", String(rows));
  params.set("start", String(request.offset));
  params.set("timeAllowed", boundedTimeAllowed());
  params.set("wt", "json");

  appendImmutablePublicFilters(params, profile);

  return {
    query: {
      path: "/select",
      params,
      expectedFields: new Set(profile.returnFields),
    },
    appliedFilters: translation.applied,
    unsupportedFilters: translation.unsupported,
  };
}

// ─── Facets (Requirements 6.1-6.5) ──────────────────────────────────────────

export interface FacetQueryRequest {
  readonly query: string;
  readonly field?: RepositorySearchRequest["field"];
  readonly filters?: SearchFilters;
  readonly facets: readonly CommonFacet[];
  readonly limit: number;
  readonly offset: number;
}

export function buildFacetQuery(
  profile: RepositoryProfile,
  request: FacetQueryRequest,
): SafeSolrQuery {
  const facetFields: string[] = [];
  for (const concept of request.facets) {
    const field = profile.facetFields[concept];
    if (!field) {
      throw new UnsafeQueryError(`Facet "${concept}" is not supported by ${profile.id}`);
    }
    facetFields.push(field);
  }

  const { query } = buildSearchQuery(profile, {
    query: request.query,
    field: request.field,
    filters: request.filters,
    limit: 1,
    offset: 0,
  });

  const params = query.params;
  params.set("rows", "0");
  params.set("facet", "true");
  params.set("facet.limit", String(FACET_VALUE_LIMIT));
  params.set("facet.mincount", "1");
  params.set("facet.sort", "count");
  for (const field of facetFields) {
    params.append("facet.field", field);
  }

  return { path: "/select", params, expectedFields: new Set() };
}

// ─── Related records via MoreLikeThis (Requirements 7.2-7.4) ────────────────

export interface RelatedQueryRequest {
  /** The source record's identity value (e.g. DSpace UUID) — escaped here. */
  readonly identityValue: string;
  readonly limit: number;
}

export function buildRelatedQuery(
  profile: RepositoryProfile,
  request: RelatedQueryRequest,
): SafeSolrQuery {
  if (profile.relatedFields.length === 0) {
    throw new UnsafeQueryError(`${profile.id} has no related-record fields`);
  }
  if (!Number.isInteger(request.limit) || request.limit < 1) {
    throw new UnsafeQueryError("limit must be a positive integer");
  }

  const params = new URLSearchParams();
  params.set("q", `${profile.identityFields.uuid}:${quoteEscaped(request.identityValue)}`);
  params.set("mlt.fl", profile.relatedFields.join(","));
  params.set("mlt.mintf", "1");
  params.set("mlt.mindf", "2");
  params.set("fl", profile.returnFields.join(","));
  params.set("rows", String(Math.min(request.limit * 3, MAX_ROWS)));
  params.set("timeAllowed", boundedTimeAllowed());
  params.set("wt", "json");

  appendImmutablePublicFilters(params, profile);

  return {
    path: "/mlt",
    params,
    expectedFields: new Set(profile.returnFields),
  };
}
