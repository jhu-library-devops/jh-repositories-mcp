/**
 * JHRDR Repository Profile — Dataverse 6.10.1 Field Manifest
 *
 * Documents the exact Solr field mappings, immutable public filters, query fields,
 * filter fields, facet fields, sort fields, related-record fields, and the fulltext
 * decision for the JHRDR (Dataverse) adapter.
 *
 * Source: Dataverse 6.10.1 schema.xml from jhu-dataverse-deployment, validated
 * against the Solr schema fixture at test/fixtures/jhrdr/solr-schema.json.
 *
 * Requirements: 3.2, 3.3, 10.2
 */

import type {
  RepositoryProfile,
  SolrFilterFactory,
  SolrSort,
  WeightedField,
} from "./jscholarship-profile";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * The published status value in Dataverse's `publicationStatus` field.
 * Datasets with at least one publicly released version carry this value.
 */
export const DATAVERSE_PUBLISHED_STATUS = "Published" as const;

/**
 * The deaccessioned status value in Dataverse's `publicationStatus` field.
 * Datasets removed from public access carry this value (may co-occur with Published).
 */
export const DATAVERSE_DEACCESSIONED_STATUS = "Deaccessioned" as const;

/**
 * The anonymous discoverability value in Dataverse's `discoverableBy` field.
 * TODO: Verify exact anonymous value from live deployment.
 */
export const DATAVERSE_ANONYMOUS_DISCOVERABLE = "Anonymous" as const;

// ─── JHRDR Profile ───────────────────────────────────────────────────────────

/**
 * JHRDR RepositoryProfile — immutable Dataverse 6.10.1 field manifest.
 *
 * All field names are extracted from the deployed Dataverse 6.10.1 schema.xml
 * (jhu-dataverse-deployment). Dataverse uses explicit field names (not dynamic
 * patterns like DSpace Discovery).
 *
 * Required system fields are those that MUST exist for the adapter to become ready.
 * Optional metadata-block fields support search, faceting, and display — their
 * absence degrades service but does not fail readiness.
 */
export const jhrdrProfile = {
  id: "jhrdr",
  platform: "dataverse",
  version: "6.10.1",
  solrCollection: "collection1",

  // ── Required Schema Fields ─────────────────────────────────────────────────
  // System identity and access-gate fields that MUST exist in the Solr schema.
  // Missing any of these fails adapter readiness.
  requiredSchemaFields: [
    "id",                  // Solr document unique key
    "entityId",            // Dataverse database entity ID (primary key)
    "dvObjectType",        // Entity type discriminator (Dataset, Dataverse, DataFile)
    "publicationStatus",   // Publication lifecycle gate (Published, Draft, Deaccessioned)
    "identifier",          // Persistent identifier string (DOI or Handle)
    "persistentUrl",       // Full persistent URL for citation
    "dateSort",            // Sort-optimized date field
    "nameSort",            // Sort-optimized name field (lowercase title)
  ],

  // ── Optional Schema Fields ─────────────────────────────────────────────────
  // Metadata-block fields from the citation metadata block and hierarchy.
  // Missing ones disable their corresponding feature but don't fail readiness.
  optionalSchemaFields: [
    "title",               // Dataset title (text_en)
    "authorName",          // Author names (text_en, multiValued)
    "authorAffiliation",   // Author institutional affiliations (text_en, multiValued)
    "authorIdentifier",    // Author identifiers e.g. ORCID (text_en, multiValued)
    "dsDescriptionValue",  // Dataset description/abstract (text_en, multiValued)
    "subject",             // Subject terms for search (text_en, multiValued)
    "dvSubject",           // Subject facets for exact-match faceting (string, multiValued)
    "keywordValue",        // Keywords (text_en, multiValued)
    "topicClassValue",     // Topic classifications (text_en, multiValued)
    "license",             // License identifier (string)
    "fileCount",           // Number of files in dataset (plong)
    "citation",            // Formatted citation string (stored, not indexed)
    "parentId",            // Parent Dataverse entity ID (hierarchy)
    "parentIdentifier",    // Parent Dataverse alias (collection filtering)
    "parentName",          // Parent Dataverse display name
    "publicationDate",     // Dataset publication date string
  ],

  // ── Query Fields ───────────────────────────────────────────────────────────
  // Maps MCP search concepts to Dataverse Solr fields with boosts for edismax qf.
  queryFields: {
    keyword: [
      { field: "_text_", boost: 1 },
      { field: "title", boost: 4 },
      { field: "authorName", boost: 3 },
      { field: "subject", boost: 2 },
      { field: "keywordValue", boost: 2 },
    ],
    title: [
      { field: "title", boost: 4 },
    ],
    creator: [
      { field: "authorName", boost: 3 },
    ],
    subject: [
      { field: "subject", boost: 2 },
      { field: "keywordValue", boost: 2 },
    ],
    abstract: [
      { field: "dsDescriptionValue", boost: 1 },
    ],
  },

  // ── Filter Fields ──────────────────────────────────────────────────────────
  // Maps MCP filter concepts to Dataverse Solr filter fields.
  filterFields: {
    subject: "dvSubject",
    publicationDate: "publicationDate",
    collection: "parentIdentifier",
    datasetType: "datasetType",
    license: "license",
  },

  // ── Facet Fields ───────────────────────────────────────────────────────────
  // Maps MCP facet concepts to Dataverse Solr fields for faceting.
  facetFields: {
    subject: "dvSubject",
    year: "publicationDate",
    collection: "parentIdentifier",
    resourceType: "datasetType",
    license: "license",
  },

  // ── Sort Fields ────────────────────────────────────────────────────────────
  // Dataverse uses dedicated dateSort (pdate) and nameSort (string) fields.
  sortFields: {
    relevance: { field: "score", direction: "desc" },
    date_desc: { field: "dateSort", direction: "desc" },
    date_asc: { field: "dateSort", direction: "asc" },
    title_asc: { field: "nameSort", direction: "asc" },
  },

  // ── Related Fields ─────────────────────────────────────────────────────────
  // Dataverse has no MoreLikeThis configuration — related search uses manual
  // query construction from these metadata fields.
  relatedFields: [
    "title",
    "authorName",
    "subject",
    "keywordValue",
    "authorAffiliation",
    "dsDescriptionValue",
  ],

  // ── Return Fields (fl) ─────────────────────────────────────────────────────
  // Fields retrieved from Solr for candidate processing and display.
  returnFields: [
    "id",
    "entityId",
    "dvObjectType",
    "publicationStatus",
    "identifier",
    "persistentUrl",
    "dateSort",
    "nameSort",
    "title",
    "authorName",
    "citation",
    "publicationDate",
    "parentIdentifier",
    "parentName",
    "license",
    "fileCount",
  ],

  // ── Identity Fields ────────────────────────────────────────────────────────
  identityFields: {
    uuid: "entityId",       // Dataverse uses entityId as the primary key
    handle: "identifier",   // Persistent identifier field (DOI or Handle)
    resourceType: "dvObjectType",
  },

  // ── Immutable Public Filters ───────────────────────────────────────────────
  // Appended to EVERY Solr query (search, facet, related).
  // No MCP client input can remove, weaken, negate, or replace them.
  //
  // Derived from Dataverse access model:
  //   - Only Dataset documents (not Dataverse collections or DataFiles)
  //   - Only publicly published versions
  //   - Exclude deaccessioned datasets (may co-occur with Published)
  immutablePublicFilters: [
    {
      description: "Restrict to Dataset documents only (exclude Dataverse collections and DataFiles)",
      fq: "dvObjectType:Dataset",
    },
    {
      description: "Only datasets with a published version",
      fq: "publicationStatus:Published",
    },
    {
      description: "Exclude deaccessioned datasets (may co-occur with Published in multiValued field)",
      fq: "-publicationStatus:Deaccessioned",
    },
    // TODO: Add discoverableBy filter once anonymous value is verified from live deployment
    // {
    //   description: "Only datasets discoverable by anonymous users",
    //   fq: `discoverableBy:${DATAVERSE_ANONYMOUS_DISCOVERABLE}`,
    // },
  ],

  // ── Fulltext Decision ──────────────────────────────────────────────────────
  // The _text_ catchall field uses text_general (basic tokenization without stemming).
  // Specific metadata fields with text_en provide better relevance.
  fulltextDecision: {
    enabled: false,
    field: "_text_",
    rationale:
      "The _text_ catchall field contains copyField content from metadata fields only (not file content). " +
      "However, it is kept out of the explicit keyword query field list because it uses text_general " +
      "(basic tokenization without stemming), and the specific metadata fields with text_en analysis " +
      "provide better relevance. The _text_ field may be enabled as a fallback in a future phase.",
    reference: "Dataverse 6.10.1 schema.xml copyField configuration",
  },
} as const satisfies RepositoryProfile;

export type JhrdrProfile = typeof jhrdrProfile;
