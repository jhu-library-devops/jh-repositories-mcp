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

import type {
  AccessInfo,
  CollectionContext,
  Creator,
  DateValue,
  ItemDetail,
  PersistentId,
  Provenance,
  PublicFileSummary,
  RepositoryId,
  RepositoryRecord,
} from "./index";
import { createRecordId } from "./identifiers";

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
export function createRepositoryRecord(
  input: RepositoryRecordInput,
): RepositoryRecord {
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

/**
 * Create an ItemDetail from a RepositoryRecord and public file summaries.
 *
 * @param record - The base RepositoryRecord.
 * @param files - The public file summaries to attach.
 * @returns A complete ItemDetail.
 */
export function createItemDetail(
  record: RepositoryRecord,
  files: PublicFileSummary[],
): ItemDetail {
  return {
    ...record,
    files,
  };
}
