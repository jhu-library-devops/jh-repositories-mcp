/**
 * Zod Schemas for MCP Tool Inputs and Outputs
 *
 * Closed schemas (`.strict()`) with bounded strings, arrays, dates,
 * identifiers, limits, and nesting. Every object-level schema rejects
 * additional properties.
 *
 * Requirements: 1.1-1.7, 5.3, 10.4, 12.4
 */

import { z } from "zod";

// ─── Shared Constants ────────────────────────────────────────────────────────

/** ISO partial date: YYYY, YYYY-MM, or YYYY-MM-DD */
const DATE_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;

const MAX_QUERY_LENGTH = 512;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_CURSOR_LENGTH = 2048;
const MAX_RESOURCE_TYPE_ITEMS = 10;
const MAX_CREATOR_ITEMS = 10;
const MAX_SUBJECT_ITEMS = 20;
const MAX_COLLECTION_ITEMS = 10;
const MAX_STRING_SHORT = 100;
const MAX_STRING_MEDIUM = 200;
const MIN_LIMIT = 1;
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

// ─── Enum Schemas ────────────────────────────────────────────────────────────

const repositorySelectorSchema = z.enum(["all", "jscholarship", "jhrdr"]);
const repositoryIdSchema = z.enum(["jscholarship", "jhrdr"]);
const searchFieldSchema = z.enum(["keyword", "title", "creator", "subject", "abstract"]);
const sortOptionSchema = z.enum(["relevance", "date_asc", "date_desc", "title_asc"]);
const accessSchema = z.enum(["open", "metadata_only"]);
const commonFacetSchema = z.enum([
  "repository",
  "creator",
  "subject",
  "year",
  "resourceType",
  "collection",
]);

// ─── Reusable Sub-Schemas ────────────────────────────────────────────────────

export const filtersSchema = z
  .object({
    dateFrom: z
      .string()
      .max(10)
      .regex(DATE_PATTERN, "Must be YYYY, YYYY-MM, or YYYY-MM-DD")
      .optional(),
    dateTo: z
      .string()
      .max(10)
      .regex(DATE_PATTERN, "Must be YYYY, YYYY-MM, or YYYY-MM-DD")
      .optional(),
    resourceTypes: z
      .array(z.string().min(1).max(MAX_STRING_SHORT))
      .max(MAX_RESOURCE_TYPE_ITEMS)
      .optional(),
    creators: z
      .array(z.string().min(1).max(MAX_STRING_MEDIUM))
      .max(MAX_CREATOR_ITEMS)
      .optional(),
    subjects: z
      .array(z.string().min(1).max(MAX_STRING_MEDIUM))
      .max(MAX_SUBJECT_ITEMS)
      .optional(),
    collections: z
      .array(z.string().min(1).max(MAX_STRING_SHORT))
      .max(MAX_COLLECTION_ITEMS)
      .optional(),
    access: accessSchema.optional(),
  })
  .strict();

// ─── Tool Input Schemas ──────────────────────────────────────────────────────

export const searchItemsInputSchema = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    repositories: repositorySelectorSchema.default("all"),
    field: searchFieldSchema.optional(),
    filters: filtersSchema.optional(),
    sort: sortOptionSchema.optional(),
    cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
    limit: z.number().int().min(MIN_LIMIT).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  })
  .strict();

export const getItemInputSchema = z
  .object({
    repository: repositoryIdSchema,
    identifier: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  })
  .strict();

export const listFacetsInputSchema = z
  .object({
    query: z.string().min(0).max(MAX_QUERY_LENGTH).optional(),
    repositories: repositorySelectorSchema.default("all"),
    field: searchFieldSchema.optional(),
    filters: filtersSchema.optional(),
    facets: z
      .array(commonFacetSchema)
      .min(1)
      .max(6)
      .optional(),
  })
  .strict();

export const findRelatedItemsInputSchema = z
  .object({
    repository: repositoryIdSchema,
    identifier: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    targetRepositories: repositorySelectorSchema.default("all"),
    limit: z.number().int().min(MIN_LIMIT).max(MAX_LIMIT).default(5),
  })
  .strict();

export const explainSearchInputSchema = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    repositories: repositorySelectorSchema.default("all"),
    field: searchFieldSchema.optional(),
    filters: filtersSchema.optional(),
    sort: sortOptionSchema.optional(),
  })
  .strict();

// ─── Output Sub-Schemas ──────────────────────────────────────────────────────

const creatorSchema = z
  .object({
    name: z.string().min(1).max(500),
    affiliation: z.string().max(500).nullable(),
    identifier: z.string().max(200).nullable(),
  })
  .strict();

const dateValueSchema = z
  .object({
    value: z.string().max(10).nullable(),
    display: z.string().max(100).nullable(),
    precision: z.enum(["day", "month", "year", "unknown"]),
  })
  .strict();

const persistentIdSchema = z
  .object({
    type: z.enum(["handle", "doi", "other"]),
    value: z.string().min(1).max(500),
    url: z.string().min(1).max(2048),
  })
  .strict();

const collectionContextSchema = z
  .object({
    id: z.string().max(200).nullable(),
    name: z.string().max(500).nullable(),
    path: z.array(z.string().max(500)).max(20),
  })
  .strict();

const accessInfoSchema = z
  .object({
    status: accessSchema,
    license: z.string().max(2048).nullable(),
    terms: z.string().max(5000).nullable(),
  })
  .strict();

const provenanceSchema = z
  .object({
    platform: z.enum(["dspace", "dataverse"]),
    platformRecordId: z.string().min(1).max(500),
    canonicalApi: z.enum(["dspace_rest", "dataverse_native_api"]),
    retrievedAt: z.string().min(1).max(30),
  })
  .strict();

export const repositoryRecordSchema = z
  .object({
    id: z.string().min(1).max(600),
    repository: repositoryIdSchema,
    kind: z.enum(["repository_item", "dataset"]),
    title: z.string().min(1).max(2000),
    creators: z.array(creatorSchema).max(200),
    date: dateValueSchema,
    abstract: z.string().max(50000).nullable(),
    subjects: z.array(z.string().max(500)).max(100),
    resourceTypes: z.array(z.string().max(200)).max(50),
    persistentId: persistentIdSchema.nullable(),
    citation: z.string().max(5000).nullable(),
    landingPageUrl: z.string().min(1).max(2048),
    collection: collectionContextSchema,
    access: accessInfoSchema,
    fileCount: z.number().int().min(0),
    formats: z.array(z.string().max(200)).max(100),
    matchedFields: z.array(z.string().max(100)).max(20),
    snippet: z.string().max(2000).nullable(),
    sourceRank: z.number().int().min(0).nullable(),
    provenance: provenanceSchema,
  })
  .strict();

const publicFileSummarySchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(500),
    format: z.string().max(200).nullable(),
    sizeBytes: z.number().int().min(0).nullable(),
    restricted: z.literal(false),
    downloadUrl: z.string().max(2048).nullable(),
  })
  .strict();

export const itemDetailSchema = repositoryRecordSchema.extend({
  files: z.array(publicFileSummarySchema).max(100),
}).strict();

// ─── Tool Output Schemas ─────────────────────────────────────────────────────

const repositoryWarningSchema = z
  .object({
    repository: repositoryIdSchema,
    code: z.enum([
      "backend_unavailable",
      "validation_attrition",
      "cursor_reset",
      "unsupported_filter",
    ]),
    message: z.string().min(1).max(1000),
  })
  .strict();

const repositoriesStatusSchema = z
  .object({
    requested: z.array(repositoryIdSchema).max(2),
    succeeded: z.array(repositoryIdSchema).max(2),
    failed: z.array(repositoryIdSchema).max(2),
  })
  .strict();

const facetValueSchema = z
  .object({
    label: z.string().min(1).max(500),
    count: z.number().int().min(0),
    repositoryBreakdown: z
      .object({
        jscholarship: z.number().int().min(0).optional(),
        jhrdr: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const facetResultSchema = z
  .object({
    facet: commonFacetSchema,
    values: z.array(facetValueSchema).max(200),
  })
  .strict();

export const searchItemsOutputSchema = z
  .object({
    results: z.array(repositoryRecordSchema).max(25),
    count: z.number().int().min(0),
    cursor: z.string().max(MAX_CURSOR_LENGTH).nullable(),
    repositories: repositoriesStatusSchema,
    warnings: z.array(repositoryWarningSchema).max(10),
    facets: z.array(facetResultSchema).max(6).optional(),
    retrievedAt: z.string().min(1).max(30),
  })
  .strict();

export const getItemOutputSchema = itemDetailSchema;

export const listFacetsOutputSchema = z
  .object({
    facets: z.array(facetResultSchema).max(6),
    repositories: repositoriesStatusSchema,
    warnings: z.array(repositoryWarningSchema).max(10),
    retrievedAt: z.string().min(1).max(30),
  })
  .strict();

export const findRelatedItemsOutputSchema = z
  .object({
    source: z
      .object({
        repository: repositoryIdSchema,
        identifier: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
        title: z.string().max(2000).nullable(),
      })
      .strict(),
    results: z.array(repositoryRecordSchema).max(25),
    count: z.number().int().min(0),
    warnings: z.array(repositoryWarningSchema).max(10),
    retrievedAt: z.string().min(1).max(30),
  })
  .strict();

export const explainSearchOutputSchema = z
  .object({
    originalQuery: z.string().min(1).max(MAX_QUERY_LENGTH),
    interpretation: z.string().min(1).max(5000),
    repositoryStrategies: z
      .array(
        z
          .object({
            repository: repositoryIdSchema,
            fieldsSearched: z.array(z.string().max(100)).max(20),
            filtersApplied: z.array(z.string().max(200)).max(20),
            filtersUnsupported: z.array(z.string().max(200)).max(20),
            sortApplied: z.string().max(100),
          })
          .strict(),
      )
      .max(2),
    warnings: z.array(repositoryWarningSchema).max(10),
    retrievedAt: z.string().min(1).max(30),
  })
  .strict();

// ─── Type Exports ────────────────────────────────────────────────────────────

export type SearchItemsInput = z.infer<typeof searchItemsInputSchema>;
export type GetItemInput = z.infer<typeof getItemInputSchema>;
export type ListFacetsInput = z.infer<typeof listFacetsInputSchema>;
export type FindRelatedItemsInput = z.infer<typeof findRelatedItemsInputSchema>;
export type ExplainSearchInput = z.infer<typeof explainSearchInputSchema>;
export type SearchItemsOutput = z.infer<typeof searchItemsOutputSchema>;
export type GetItemOutput = z.infer<typeof getItemOutputSchema>;
export type ListFacetsOutput = z.infer<typeof listFacetsOutputSchema>;
export type FindRelatedItemsOutput = z.infer<typeof findRelatedItemsOutputSchema>;
export type ExplainSearchOutput = z.infer<typeof explainSearchOutputSchema>;
