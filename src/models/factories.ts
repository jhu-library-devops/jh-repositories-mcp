/**
 * Model Construction Factories
 *
 * Factory functions that ensure the correct shape for domain models:
 * - All required-but-nullable fields are present (not omitted)
 * - Multi-valued fields default to empty arrays
 * - Record IDs are namespaced by repository
 *
 * Requirements: 4.1-4.6, 5.1-5.5
 */

import { createRecordId } from "./identifiers";
import type {
  AccessInfo,
  CollectionContext,
  Creator,
  DateValue,
  ItemDetail,
  MetadataField,
  PersistentId,
  Provenance,
  PublicFileSummary,
  RepositoryId,
  RepositoryRecord,
} from "./index";

/**
 * Input for creating a RepositoryRecord. Adapters provide these fields.
 * Optional nullable fields may be omitted — the factory fills them with null.
 * Multi-valued fields may be omitted — the factory fills them with [].
 */
export interface RepositoryRecordInput {
  /** Platform-specific ID (UUID, DOI, Handle, etc.). Used to create the namespaced id. */
  platformId: string;
  repository: RepositoryId;
  kind: "repository_item" | "dataset";
  title: string;
  landingPageUrl: string;
  provenance: Provenance;

  // Fields with defaults (nullable → null, arrays → [])
  creators?: Creator[];
  date?: DateValue;
  abstract?: string | null;
  subjects?: string[];
  resourceTypes?: string[];
  persistentId?: PersistentId | null;
  citation?: string | null;
  collection?: CollectionContext;
  access?: AccessInfo;
  fileCount?: number;
  formats?: string[];
  matchedFields?: string[];
  snippet?: string | null;
  sourceRank?: number | null;
}

/** Default date value when none is provided. */
const DEFAULT_DATE: DateValue = {
  value: null,
  display: null,
  precision: "unknown",
};

/** Default collection context when none is provided. */
const DEFAULT_COLLECTION: CollectionContext = {
  id: null,
  name: null,
  path: [],
};

/** Default access info when none is provided. */
const DEFAULT_ACCESS: AccessInfo = {
  status: "open",
  license: null,
  terms: null,
};

/**
 * Create a RepositoryRecord with all required fields present.
 *
 * Missing optional values are set to null; missing arrays are set to [].
 * The `id` field is automatically namespaced as "repository:platformId".
 *
 * @param input - The adapter-provided fields.
 * @returns A complete RepositoryRecord with no omitted fields.
 */
export function createRepositoryRecord(input: RepositoryRecordInput): RepositoryRecord {
  return {
    id: createRecordId(input.repository, input.platformId),
    repository: input.repository,
    kind: input.kind,
    title: input.title,
    creators: input.creators ?? [],
    date: input.date ?? DEFAULT_DATE,
    abstract: input.abstract ?? null,
    subjects: input.subjects ?? [],
    resourceTypes: input.resourceTypes ?? [],
    persistentId: input.persistentId ?? null,
    citation: input.citation ?? null,
    landingPageUrl: input.landingPageUrl,
    collection: input.collection ?? DEFAULT_COLLECTION,
    access: input.access ?? DEFAULT_ACCESS,
    fileCount: input.fileCount ?? 0,
    formats: input.formats ?? [],
    matchedFields: input.matchedFields ?? [],
    snippet: input.snippet ?? null,
    sourceRank: input.sourceRank ?? null,
    provenance: input.provenance,
  };
}

// ─── Canonical metadata bounds (Requirement 5.1) ────────────────────────────

/** Maximum distinct metadata fields returned for one item. */
export const MAX_METADATA_FIELDS = 200;
/** Maximum values returned per metadata field. */
export const MAX_METADATA_VALUES_PER_FIELD = 100;
/** Maximum characters per metadata value; longer values are truncated. */
export const MAX_METADATA_VALUE_LENGTH = 10_000;
/** Maximum characters in a metadata field name; longer names are dropped. */
export const MAX_METADATA_FIELD_NAME_LENGTH = 200;

/**
 * Bound and order canonical metadata: repeated field names merge, empty
 * values and empty fields drop, fields sort by name, and every dimension is
 * capped so a pathological record cannot blow up the response.
 */
export function boundMetadata(fields: readonly MetadataField[]): MetadataField[] {
  const merged = new Map<string, string[]>();
  for (const { field, values } of fields) {
    if (field.length === 0 || field.length > MAX_METADATA_FIELD_NAME_LENGTH) {
      continue;
    }
    const bucket = merged.get(field) ?? [];
    for (const value of values) {
      if (value.length > 0 && bucket.length < MAX_METADATA_VALUES_PER_FIELD) {
        bucket.push(value.slice(0, MAX_METADATA_VALUE_LENGTH));
      }
    }
    merged.set(field, bucket);
  }
  return [...merged.entries()]
    .filter(([, values]) => values.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_METADATA_FIELDS)
    .map(([field, values]) => ({ field, values }));
}

/**
 * Create an ItemDetail from a RepositoryRecord, public file summaries, and
 * the record's full public canonical metadata.
 *
 * @param record - The base RepositoryRecord.
 * @param files - The public file summaries to attach.
 * @param metadata - Canonical metadata fields; bounded and ordered here.
 * @returns A complete ItemDetail.
 */
export function createItemDetail(
  record: RepositoryRecord,
  files: PublicFileSummary[],
  metadata: readonly MetadataField[] = [],
): ItemDetail {
  return {
    ...record,
    files,
    metadata: boundMetadata(metadata),
  };
}
