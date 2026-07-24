/**
 * Core Domain Models
 *
 * Type-only exports defining the normalized data model shared across
 * adapters, federation, MCP tools, and tests. No runtime code.
 *
 * Requirements: 4.1-4.7, 5.1-5.5
 */

// ─── Runtime Helpers ─────────────────────────────────────────────────────────

export {
  createRecordId,
  parseRecordId,
  recordIdsCollide,
} from "./identifiers";

export {
  createRepositoryRecord,
  createItemDetail,
  type RepositoryRecordInput,
} from "./factories";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export {
  filtersSchema,
  searchItemsInputSchema,
  getItemInputSchema,
  listFacetsInputSchema,
  findRelatedItemsInputSchema,
  explainSearchInputSchema,
  repositoryRecordSchema,
  itemDetailSchema,
  searchItemsOutputSchema,
  getItemOutputSchema,
  listFacetsOutputSchema,
  findRelatedItemsOutputSchema,
  explainSearchOutputSchema,
  type SearchItemsInput,
  type GetItemInput,
  type ListFacetsInput,
  type FindRelatedItemsInput,
  type ExplainSearchInput,
  type SearchItemsOutput,
  type GetItemOutput,
  type ListFacetsOutput,
  type FindRelatedItemsOutput,
  type ExplainSearchOutput,
} from "./schemas";

// ─── Repository Identity ─────────────────────────────────────────────────────

export type RepositoryId = "jscholarship" | "jhrdr";

// ─── Creator ─────────────────────────────────────────────────────────────────

export interface Creator {
  name: string;
  affiliation: string | null;
  identifier: string | null;
}

// ─── Public File Summary ─────────────────────────────────────────────────────

export interface PublicFileSummary {
  id: string;
  name: string;
  format: string | null;
  sizeBytes: number | null;
  restricted: false;
  downloadUrl: string | null;
}

// ─── Persistent Identifier ───────────────────────────────────────────────────

export interface PersistentId {
  type: "handle" | "doi" | "other";
  value: string;
  url: string;
}

// ─── Date Value ──────────────────────────────────────────────────────────────

export interface DateValue {
  value: string | null;
  display: string | null;
  precision: "day" | "month" | "year" | "unknown";
}

// ─── Collection Context ──────────────────────────────────────────────────────

export interface CollectionContext {
  id: string | null;
  name: string | null;
  path: string[];
}

// ─── Access Information ──────────────────────────────────────────────────────

export interface AccessInfo {
  status: "open" | "metadata_only";
  license: string | null;
  terms: string | null;
}

// ─── Provenance ──────────────────────────────────────────────────────────────

export interface Provenance {
  platform: "dspace" | "dataverse";
  platformRecordId: string;
  canonicalApi: "dspace_rest" | "dataverse_native_api";
  retrievedAt: string;
}

// ─── Repository Record (Search Result) ───────────────────────────────────────

export interface RepositoryRecord {
  id: string;
  repository: RepositoryId;
  kind: "repository_item" | "dataset";
  title: string;
  creators: Creator[];
  date: DateValue;
  abstract: string | null;
  subjects: string[];
  resourceTypes: string[];
  persistentId: PersistentId | null;
  citation: string | null;
  landingPageUrl: string;
  collection: CollectionContext;
  access: AccessInfo;
  fileCount: number;
  formats: string[];
  matchedFields: string[];
  snippet: string | null;
  sourceRank: number | null;
  provenance: Provenance;
}

// ─── Item Detail (Full Record) ───────────────────────────────────────────────

export interface ItemDetail extends RepositoryRecord {
  files: PublicFileSummary[];
}

// ─── Search Request ──────────────────────────────────────────────────────────

export type SearchField = "keyword" | "title" | "creator" | "subject" | "abstract";

export type SortOption = "relevance" | "date_asc" | "date_desc" | "title_asc";

export interface SearchFilters {
  dateFrom?: string;
  dateTo?: string;
  resourceTypes?: string[];
  creators?: string[];
  subjects?: string[];
  collections?: string[];
  access?: "open" | "metadata_only";
}

export interface SearchRequest {
  query: string;
  repositories: RepositoryId[] | "all";
  field?: SearchField;
  filters?: SearchFilters;
  sort?: SortOption;
  cursor?: string;
  limit?: number;
}

// ─── Repository-Level Search Request ─────────────────────────────────────────

export interface RepositorySearchRequest {
  query: string;
  field?: SearchField;
  filters?: SearchFilters;
  sort?: SortOption;
  limit: number;
  offset: number;
}

// ─── Repository Page ─────────────────────────────────────────────────────────

export interface RepositoryWarning {
  repository: RepositoryId;
  code: "backend_unavailable" | "validation_attrition" | "cursor_reset" | "unsupported_filter";
  message: string;
}

export interface RepositoryPage {
  repository: RepositoryId;
  results: RepositoryRecord[];
  nextOffset: number | null;
  totalCandidates: number;
  validationOmissions: number;
  warnings: RepositoryWarning[];
}

// ─── Federated Search Response ───────────────────────────────────────────────

export interface SearchResponse {
  results: RepositoryRecord[];
  count: number;
  cursor: string | null;
  repositories: {
    requested: RepositoryId[];
    succeeded: RepositoryId[];
    failed: RepositoryId[];
  };
  warnings: RepositoryWarning[];
  facets?: FacetResult[];
  retrievedAt: string;
}

// ─── Facets ──────────────────────────────────────────────────────────────────

export type CommonFacet =
  | "repository"
  | "creator"
  | "subject"
  | "year"
  | "resourceType"
  | "collection";

export interface FacetValue {
  label: string;
  count: number;
  repositoryBreakdown?: Partial<Record<RepositoryId, number>>;
}

export interface FacetResult {
  facet: CommonFacet;
  values: FacetValue[];
}

export interface RepositoryFacetRequest {
  query: string;
  field?: SearchField;
  filters?: SearchFilters;
  facets: CommonFacet[];
  limit: number;
  offset: number;
}

export interface RepositoryFacets {
  repository: RepositoryId;
  facets: FacetResult[];
  warnings: RepositoryWarning[];
}

// ─── Related Records ─────────────────────────────────────────────────────────

export interface RelatedRequest {
  repositories: RepositoryId[] | "all";
  limit: number;
}

// ─── Schema Validation ───────────────────────────────────────────────────────

export interface SchemaValidationResult {
  repository: RepositoryId;
  valid: boolean;
  missingRequired: string[];
  missingOptional: string[];
  disabledFeatures: string[];
}

// ─── Repository Identifier ───────────────────────────────────────────────────

export interface RepositoryIdentifier {
  repository: RepositoryId;
  value: string;
  type: "uuid" | "handle" | "doi" | "persistent_id" | "namespaced";
}

// ─── Tool Error ──────────────────────────────────────────────────────────────

export type ToolErrorCode =
  | "invalid_input"
  | "unsupported_parameter"
  | "not_found"
  | "backend_unavailable"
  | "deadline_exceeded"
  | "rate_limited"
  | "capability_unavailable";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
