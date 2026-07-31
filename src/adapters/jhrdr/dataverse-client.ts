/**
 * Dataverse Canonical Native API Client
 *
 * Anonymous, read-only client for the private Dataverse Native API. Resolves
 * datasets by persistent identifier (DOI or Handle), always requesting the
 * latest published version — never :draft or :latest — and never sending an
 * X-Dataverse-key header or Bearer token. Enforces the Public_Record gate
 * (anonymous retrievability + RELEASED version state), normalizes citation
 * metadata, and expands public file summaries capped at 100 with restricted
 * files excluded — never file bytes.
 *
 * A nonexistent identifier and a non-public (draft, deaccessioned, or
 * anonymous-inaccessible) identifier are indistinguishable: both resolve to
 * null. Backend faults (timeout, 5xx, malformed payloads) throw
 * DataverseRequestError so callers fail closed.
 *
 * Requirements: 3.4-3.8, 4, 5.1-5.4, 9.3-9.5, 14.1, 15.9, 17.3
 */

import type {
  AccessInfo,
  Creator,
  DateValue,
  ItemDetail,
  PersistentId,
  PublicFileSummary,
} from "../../models/index";
import { createItemDetail, createRepositoryRecord } from "../../models/index";
import { withRetry } from "../retry";

// ─── Public constants ────────────────────────────────────────────────────────

/** Maximum file summaries expanded for a full dataset (Requirement 5.2). */
export const MAX_FILE_SUMMARIES = 100;

// ─── Identifier validation (reject before I/O) ───────────────────────────────

/** DOI shape with optional `doi:` scheme, e.g. `doi:10.7281/T1ABCDEF`. */
const DOI_PATTERN = /^(doi:)?10\.\d{4,9}\/[A-Za-z0-9._;()/-]{1,128}$/;

/** Handle shape with optional `hdl:` scheme. */
const HANDLE_PATTERN = /^(hdl:)?[0-9][0-9.]{0,20}\/[A-Za-z0-9._-]{1,64}$/;

/**
 * Normalizes an accepted persistent identifier to its scheme-prefixed form
 * (`doi:...` / `hdl:...`), or returns null for anything malformed.
 */
export function normalizePersistentId(value: string): string | null {
  if (DOI_PATTERN.test(value)) {
    return value.startsWith("doi:") ? value : `doi:${value}`;
  }
  if (HANDLE_PATTERN.test(value)) {
    return value.startsWith("hdl:") ? value : `hdl:${value}`;
  }
  return null;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class DataverseRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DataverseRequestError";
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface DataverseClientOptions {
  /** Private Dataverse Native API base, e.g. http://dataverse.internal:8080/api */
  readonly apiBaseUrl: URL;
  /** Public JHRDR base used for landing-page and download URLs. */
  readonly publicBaseUrl: URL;
  readonly requestTimeoutMs: number;
  readonly fetchImpl?: FetchLike;
}

interface CitationField {
  readonly typeName?: unknown;
  readonly value?: unknown;
}

export class DataverseClient {
  private readonly apiBaseUrl: URL;
  private readonly publicBaseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: DataverseClientOptions) {
    this.apiBaseUrl = normalizeBase(options.apiBaseUrl);
    this.publicBaseUrl = normalizeBase(options.publicBaseUrl);
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /**
   * Resolves the latest published version of a public dataset to a normalized
   * ItemDetail, or null when the identifier is nonexistent or non-public
   * (indistinguishably). When `expandFiles` is false the Native API is asked
   * to exclude file listings for a lighter payload.
   */
  async resolveDataset(
    persistentId: string,
    options: { expandFiles: boolean },
  ): Promise<ItemDetail | null> {
    const normalized = normalizePersistentId(persistentId);
    if (normalized === null) {
      return null;
    }

    const target = this.versionUrl(normalized, !options.expandFiles);
    const response = await this.request(target, "GET");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new DataverseRequestError(
        `Dataverse returned HTTP ${response.status}`,
        response.status,
      );
    }

    const body = (await parseJson(response)) as {
      status?: unknown;
      data?: Record<string, unknown>;
    };
    if (body.status !== "OK" || typeof body.data !== "object" || body.data === null) {
      throw new DataverseRequestError("Dataverse returned an unexpected payload shape");
    }
    const version = body.data;
    if (version.versionState !== "RELEASED") {
      return null;
    }

    return this.normalizeDataset(normalized, version, options.expandFiles);
  }

  /**
   * Minimal-GET revalidation probe used before emitting cached records
   * (Requirement 15.9): re-checks that the latest published version is still
   * anonymously retrievable and RELEASED. Throws on backend faults so cache
   * layers fail closed.
   */
  async probeDatasetPublic(persistentId: string): Promise<boolean> {
    const normalized = normalizePersistentId(persistentId);
    if (normalized === null) {
      return false;
    }
    const response = await this.request(this.versionUrl(normalized, true), "GET");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new DataverseRequestError(
        `Dataverse probe returned HTTP ${response.status}`,
        response.status,
      );
    }
    const body = (await parseJson(response)) as {
      status?: unknown;
      data?: { versionState?: unknown };
    };
    return body.status === "OK" && body.data?.versionState === "RELEASED";
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private versionUrl(persistentId: string, excludeFiles: boolean): URL {
    const target = new URL("datasets/:persistentId/versions/:latest-published", this.apiBaseUrl);
    target.searchParams.set("persistentId", persistentId);
    if (excludeFiles) {
      target.searchParams.set("excludeFiles", "true");
    }
    return target;
  }

  private normalizeDataset(
    persistentId: string,
    version: Record<string, unknown>,
    expandFiles: boolean,
  ): ItemDetail {
    const fields = citationFields(version);
    const title = primitiveField(fields, "title") ?? "Untitled dataset";
    const creators = authorField(fields);
    const subjects = [
      ...vocabularyField(fields, "subject"),
      ...compoundField(fields, "keyword", "keywordValue"),
    ];
    const abstract = compoundField(fields, "dsDescription", "dsDescriptionValue")[0] ?? null;

    const { files, publicCount, formats } = expandFiles
      ? this.normalizeFiles(version.files)
      : { files: [], publicCount: 0, formats: [] };

    const landingPageUrl = new URL("dataset.xhtml", this.publicBaseUrl);
    landingPageUrl.searchParams.set("persistentId", persistentId);

    const record = createRepositoryRecord({
      platformId: persistentId,
      repository: "jhrdr",
      kind: "dataset",
      title,
      landingPageUrl: landingPageUrl.toString(),
      provenance: {
        platform: "dataverse",
        platformRecordId: persistentId,
        canonicalApi: "dataverse_native_api",
        retrievedAt: new Date().toISOString(),
      },
      creators,
      date: parseDate(version),
      abstract,
      subjects,
      resourceTypes: ["Dataset"],
      persistentId: toPersistentId(persistentId),
      citation: typeof version.citation === "string" ? version.citation : null,
      access: normalizeAccess(version, publicCount),
      fileCount: publicCount,
      formats,
    });
    return createItemDetail(record, files);
  }

  private normalizeFiles(rawFiles: unknown): {
    files: PublicFileSummary[];
    publicCount: number;
    formats: string[];
  } {
    if (!Array.isArray(rawFiles)) {
      return { files: [], publicCount: 0, formats: [] };
    }
    const publicFiles = rawFiles.filter(
      (raw) => (raw as { restricted?: unknown }).restricted !== true,
    );
    const files: PublicFileSummary[] = [];
    const formats = new Set<string>();
    for (const raw of publicFiles.slice(0, MAX_FILE_SUMMARIES)) {
      const entry = raw as {
        label?: unknown;
        dataFile?: { id?: unknown; filename?: unknown; contentType?: unknown; filesize?: unknown };
      };
      const dataFile = entry.dataFile;
      if (!dataFile || typeof dataFile.id !== "number") {
        continue;
      }
      const contentType = typeof dataFile.contentType === "string" ? dataFile.contentType : null;
      if (contentType) {
        formats.add(contentType);
      }
      const name =
        typeof dataFile.filename === "string"
          ? dataFile.filename
          : typeof entry.label === "string"
            ? entry.label
            : String(dataFile.id);
      files.push({
        id: String(dataFile.id),
        name,
        format: contentType,
        sizeBytes: typeof dataFile.filesize === "number" ? dataFile.filesize : null,
        restricted: false,
        downloadUrl: new URL(`api/access/datafile/${dataFile.id}`, this.publicBaseUrl).toString(),
      });
    }
    return { files, publicCount: publicFiles.length, formats: [...formats] };
  }

  private async request(target: URL, method: "GET"): Promise<Response> {
    try {
      // Idempotent read: at most one retry for network faults and 5xx.
      return await withRetry(
        async () => {
          const attempt = await this.fetchImpl(target, {
            method,
            // Anonymous by design: no X-Dataverse-key, no Authorization (Req 14.1).
            headers: { accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(this.requestTimeoutMs),
          });
          if (attempt.status >= 500) {
            throw new DataverseRequestError(
              `Dataverse returned HTTP ${attempt.status}`,
              attempt.status,
            );
          }
          return attempt;
        },
        {
          isTransient: (error) =>
            !(error instanceof DataverseRequestError) ||
            error.status === undefined ||
            error.status >= 500,
        },
      );
    } catch (cause) {
      if (cause instanceof DataverseRequestError) {
        throw cause;
      }
      throw new DataverseRequestError(
        cause instanceof Error ? cause.message : "Dataverse request failed",
      );
    }
  }
}

// ─── Normalization helpers ───────────────────────────────────────────────────

function citationFields(version: Record<string, unknown>): CitationField[] {
  const blocks = version.metadataBlocks as { citation?: { fields?: unknown } } | undefined;
  const fields = blocks?.citation?.fields;
  return Array.isArray(fields) ? (fields as CitationField[]) : [];
}

function primitiveField(fields: CitationField[], typeName: string): string | null {
  for (const field of fields) {
    if (field.typeName === typeName && typeof field.value === "string" && field.value.length > 0) {
      return field.value;
    }
  }
  return null;
}

function vocabularyField(fields: CitationField[], typeName: string): string[] {
  for (const field of fields) {
    if (field.typeName === typeName && Array.isArray(field.value)) {
      return field.value.filter((v): v is string => typeof v === "string" && v.length > 0);
    }
  }
  return [];
}

function compoundField(fields: CitationField[], typeName: string, subField: string): string[] {
  for (const field of fields) {
    if (field.typeName !== typeName || !Array.isArray(field.value)) {
      continue;
    }
    const values: string[] = [];
    for (const entry of field.value) {
      const sub = (entry as Record<string, { value?: unknown }>)[subField];
      if (sub && typeof sub.value === "string" && sub.value.length > 0) {
        values.push(sub.value);
      }
    }
    return values;
  }
  return [];
}

function authorField(fields: CitationField[]): Creator[] {
  for (const field of fields) {
    if (field.typeName !== "author" || !Array.isArray(field.value)) {
      continue;
    }
    const creators: Creator[] = [];
    for (const entry of field.value) {
      const compound = entry as Record<string, { value?: unknown }>;
      const name = compound.authorName?.value;
      if (typeof name !== "string" || name.length === 0) {
        continue;
      }
      const affiliation = compound.authorAffiliation?.value;
      creators.push({
        name,
        affiliation: typeof affiliation === "string" && affiliation.length > 0 ? affiliation : null,
        identifier: null,
      });
    }
    return creators;
  }
  return [];
}

function parseDate(version: Record<string, unknown>): DateValue {
  const publicationDate = version.publicationDate;
  if (typeof publicationDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(publicationDate)) {
    return { value: publicationDate, display: publicationDate, precision: "day" };
  }
  if (typeof publicationDate === "string" && /^\d{4}$/.test(publicationDate)) {
    return { value: publicationDate, display: publicationDate, precision: "year" };
  }
  const releaseTime = version.releaseTime;
  if (typeof releaseTime === "string" && /^\d{4}-\d{2}-\d{2}/.test(releaseTime)) {
    const day = releaseTime.slice(0, 10);
    return { value: day, display: day, precision: "day" };
  }
  return { value: null, display: null, precision: "unknown" };
}

function toPersistentId(normalized: string): PersistentId {
  if (normalized.startsWith("doi:")) {
    const bare = normalized.slice(4);
    return { type: "doi", value: bare, url: `https://doi.org/${bare}` };
  }
  const bare = normalized.slice(4);
  return { type: "handle", value: bare, url: `https://hdl.handle.net/${bare}` };
}

function normalizeAccess(version: Record<string, unknown>, publicCount: number): AccessInfo {
  const license = version.license;
  const licenseName =
    typeof license === "object" && license !== null && "name" in license
      ? typeof (license as { name?: unknown }).name === "string"
        ? (license as { name: string }).name
        : null
      : typeof license === "string"
        ? license
        : null;
  return {
    status: publicCount > 0 ? "open" : "metadata_only",
    license: licenseName,
    terms: typeof version.termsOfUse === "string" ? version.termsOfUse : null,
  };
}

function normalizeBase(url: URL): URL {
  const normalized = new URL(url.toString());
  normalized.hash = "";
  normalized.search = "";
  if (!normalized.pathname.endsWith("/")) {
    normalized.pathname = `${normalized.pathname}/`;
  }
  return normalized;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DataverseRequestError("Dataverse returned malformed JSON");
  }
}
