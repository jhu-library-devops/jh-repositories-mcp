/**
 * DSpace Canonical REST Client
 *
 * Anonymous, read-only client for the private DSpace REST route. Resolves
 * items by UUID or Handle, enforces the Public_Record gate (anonymous
 * retrievability + archived, discoverable, non-withdrawn, latest state),
 * normalizes canonical metadata, and expands public ORIGINAL bitstream
 * summaries capped at 100 — never file bytes.
 *
 * A nonexistent identifier and a non-public identifier are indistinguishable:
 * both resolve to null. Backend faults (timeout, 5xx, malformed payloads)
 * throw DSpaceRequestError so callers fail closed instead of treating a
 * broken backend as "not found".
 *
 * Requirements: 2.4-2.6, 4, 5.1-5.4, 9.3-9.5, 15.9, 17.3
 */

import type {
  AccessInfo,
  Creator,
  DateValue,
  FilesStatus,
  ItemDetail,
  MetadataField,
  PublicFileSummary,
} from "../../models/index";
import { createItemDetail, createRepositoryRecord } from "../../models/index";
import { withRetry } from "../retry";

// ─── Public constants ────────────────────────────────────────────────────────

/** Maximum bitstream summaries expanded for a full item (Requirement 5.2). */
export const MAX_FILE_SUMMARIES = 100;

// ─── Identifier validation (Requirement 5.3: reject before I/O) ─────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DSpace Handles look like `<prefix>/<suffix>`, e.g. `1774.2/99999`. */
const HANDLE_PATTERN = /^[0-9][0-9.]{0,20}\/[A-Za-z0-9._-]{1,64}$/;

export function isValidDspaceUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isValidHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value);
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Which DSpace REST call failed; logged for diagnosis, never shown to clients. */
export type DSpaceOperation = "item" | "handle_lookup" | "bundles" | "probe";

export class DSpaceRequestError extends Error {
  operation?: DSpaceOperation;

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DSpaceRequestError";
  }
}

// ─── Canonical metadata exposure ─────────────────────────────────────────────

/**
 * Fields withheld from the metadata passthrough even when the anonymous REST
 * response carries them. DSpace hides `dc.description.provenance` from
 * anonymous users by default (`metadata.hide`), but it records submitter
 * names and email addresses, so it is dropped here as well in case that
 * setting is ever changed.
 */
const WITHHELD_METADATA_FIELDS: ReadonlySet<string> = new Set(["dc.description.provenance"]);

// ─── Client ──────────────────────────────────────────────────────────────────

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface DSpaceClientOptions {
  /** Private DSpace REST base, e.g. http://dspace.internal:8080/server/api */
  readonly apiBaseUrl: URL;
  /** Public JScholarship base used for landing-page and download URLs. */
  readonly publicBaseUrl: URL;
  readonly requestTimeoutMs: number;
  readonly fetchImpl?: FetchLike;
}

export interface DSpaceItemIdentifier {
  readonly type: "uuid" | "handle";
  readonly value: string;
}

interface DspaceMetadataValue {
  readonly value?: unknown;
}

type DspaceMetadata = Readonly<Record<string, readonly DspaceMetadataValue[]>>;

export class DSpaceClient {
  private readonly apiBaseUrl: URL;
  private readonly publicBaseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: DSpaceClientOptions) {
    this.apiBaseUrl = normalizeBase(options.apiBaseUrl);
    this.publicBaseUrl = normalizeBase(options.publicBaseUrl);
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /**
   * Resolves a Public_Record to a normalized ItemDetail, or null when the
   * identifier is nonexistent or non-public (indistinguishably). When
   * `expandFiles` is true, public ORIGINAL bitstream summaries are included.
   */
  async resolveItem(
    identifier: DSpaceItemIdentifier,
    options: { expandFiles: boolean; onFilesFault?: (cause: DSpaceRequestError) => void },
  ): Promise<ItemDetail | null> {
    const item = await this.fetchItem(identifier);
    if (item === null) {
      return null;
    }
    if (!passesPublicGate(item)) {
      return null;
    }

    const uuid = String(item.uuid);
    let files: PublicFileSummary[] = [];
    let fileCount = 0;
    let formats: string[] = [];
    let filesStatus: FilesStatus = "complete";
    if (options.expandFiles) {
      // The item already passed the public gate, so a failed file listing
      // degrades to metadata without files rather than failing the lookup.
      // Omitting files is fail-closed: nothing unvalidated is returned.
      try {
        const expanded = await this.fetchOriginalBitstreams(uuid);
        files = expanded.files;
        fileCount = expanded.totalCount;
        formats = expanded.formats;
      } catch (cause) {
        if (!(cause instanceof DSpaceRequestError)) {
          throw cause;
        }
        filesStatus = "unavailable";
        options.onFilesFault?.(cause);
      }
    }

    return normalizeItem(item, {
      files,
      fileCount,
      formats,
      filesStatus,
      publicBaseUrl: this.publicBaseUrl,
    });
  }

  /**
   * Lightweight revalidation probe used before emitting cached records
   * (Requirement 15.9). Returns false when the item is no longer anonymously
   * retrievable; throws on backend faults so cache layers fail closed.
   */
  async probeItemPublic(uuid: string): Promise<boolean> {
    if (!isValidDspaceUuid(uuid)) {
      return false;
    }
    const response = await this.request(
      new URL(`core/items/${uuid}`, this.apiBaseUrl),
      "HEAD",
      "probe",
    );
    if (response.status === 200) {
      return true;
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return false;
    }
    throw tagged(
      new DSpaceRequestError(`DSpace probe returned HTTP ${response.status}`, response.status),
      "probe",
    );
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async fetchItem(
    identifier: DSpaceItemIdentifier,
  ): Promise<Record<string, unknown> | null> {
    let target: URL;
    if (identifier.type === "uuid") {
      if (!isValidDspaceUuid(identifier.value)) {
        return null;
      }
      target = new URL(`core/items/${identifier.value}`, this.apiBaseUrl);
    } else {
      if (!isValidHandle(identifier.value)) {
        return null;
      }
      const resolved = await this.resolveHandle(identifier.value);
      if (resolved === null) {
        return null;
      }
      target = resolved;
    }

    const response = await this.request(target, "GET", "item");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw tagged(
        new DSpaceRequestError(`DSpace returned HTTP ${response.status}`, response.status),
        "item",
      );
    }
    const body = await parseJson(response, "item");
    if (typeof body !== "object" || body === null) {
      throw tagged(new DSpaceRequestError("DSpace returned a non-object item payload"), "item");
    }
    return body as Record<string, unknown>;
  }

  /**
   * Resolve a Handle to its item endpoint. DSpace 7 answers `pid/find` with a
   * 302 whose Location is the object's REST URL; the redirect is read, not
   * followed, and accepted only when it points at an item under our own API
   * base. A Handle for a community or collection, or a Location anywhere
   * else, resolves to null (not found), never to an outbound request.
   */
  private async resolveHandle(handle: string): Promise<URL | null> {
    const lookup = new URL("pid/find", this.apiBaseUrl);
    lookup.searchParams.set("id", `hdl:${handle}`);
    const response = await this.request(lookup, "GET", "handle_lookup", "manual");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) {
        throw tagged(
          new DSpaceRequestError("DSpace Handle redirect had no Location", response.status),
          "handle_lookup",
        );
      }
      return this.toItemUrl(location);
    }
    if (response.ok) {
      // Tolerate a pid/find that answers 200 with the object instead of redirecting.
      const body = (await parseJson(response, "handle_lookup")) as { uuid?: unknown } | null;
      const uuid = body?.uuid;
      return typeof uuid === "string" && isValidDspaceUuid(uuid)
        ? new URL(`core/items/${uuid}`, this.apiBaseUrl)
        : null;
    }
    throw tagged(
      new DSpaceRequestError(`DSpace returned HTTP ${response.status}`, response.status),
      "handle_lookup",
    );
  }

  /**
   * Map a `pid/find` Location to our API base. DSpace builds the Location
   * from `dspace.server.url` (its public hostname), which is not the private
   * ALB this client talks to, so only the `core/items/<uuid>` path suffix is
   * trusted; the host in the Location is never contacted.
   */
  private toItemUrl(location: string): URL | null {
    let parsed: URL;
    try {
      parsed = new URL(location, this.apiBaseUrl);
    } catch {
      return null;
    }
    const match = /\/api\/core\/items\/([^/]+)\/?$/.exec(parsed.pathname);
    const uuid = match?.[1];
    if (uuid === undefined || !isValidDspaceUuid(uuid)) {
      return null;
    }
    return new URL(`core/items/${uuid}`, this.apiBaseUrl);
  }

  private async fetchOriginalBitstreams(uuid: string): Promise<{
    files: PublicFileSummary[];
    totalCount: number;
    formats: string[];
  }> {
    const target = new URL(`core/items/${uuid}/bundles`, this.apiBaseUrl);
    target.searchParams.set("embed", "bitstreams");
    // One attempt only: the listing is best-effort, and skipping the retry
    // keeps a slow bundles endpoint from pushing get_item past its deadline.
    const response = await this.request(target, "GET", "bundles", "error", false);
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { files: [], totalCount: 0, formats: [] };
    }
    if (!response.ok) {
      throw tagged(
        new DSpaceRequestError(`DSpace returned HTTP ${response.status}`, response.status),
        "bundles",
      );
    }

    const body = (await parseJson(response, "bundles")) as {
      _embedded?: { bundles?: unknown[] };
    };
    const bundles = Array.isArray(body?._embedded?.bundles) ? body._embedded.bundles : [];
    const original = bundles.find((bundle) => (bundle as { name?: unknown }).name === "ORIGINAL") as
      | { _embedded?: { bitstreams?: { _embedded?: { bitstreams?: unknown[] } } } }
      | undefined;

    const bitstreams = original?._embedded?.bitstreams?._embedded?.bitstreams ?? [];
    const files: PublicFileSummary[] = [];
    const formats = new Set<string>();
    for (const raw of bitstreams.slice(0, MAX_FILE_SUMMARIES)) {
      const bitstream = raw as {
        uuid?: unknown;
        name?: unknown;
        sizeBytes?: unknown;
        _format?: { mimetype?: unknown; shortDescription?: unknown };
      };
      if (typeof bitstream.uuid !== "string") {
        continue;
      }
      const mimetype =
        typeof bitstream._format?.mimetype === "string" ? bitstream._format.mimetype : null;
      if (mimetype) {
        formats.add(mimetype);
      }
      files.push({
        id: bitstream.uuid,
        name: typeof bitstream.name === "string" ? bitstream.name : bitstream.uuid,
        format: mimetype,
        sizeBytes: typeof bitstream.sizeBytes === "number" ? bitstream.sizeBytes : null,
        restricted: false,
        downloadUrl: new URL(
          `bitstreams/${bitstream.uuid}/download`,
          this.publicBaseUrl,
        ).toString(),
      });
    }

    return { files, totalCount: bitstreams.length, formats: [...formats] };
  }

  private async request(
    target: URL,
    method: "GET" | "HEAD",
    operation: DSpaceOperation,
    redirect: "error" | "manual" = "error",
    retry = true,
  ): Promise<Response> {
    const attemptOnce = async () => {
      const attempt = await this.fetchImpl(target, {
        method,
        headers: { accept: "application/json" },
        redirect,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (attempt.status >= 500) {
        throw new DSpaceRequestError(`DSpace returned HTTP ${attempt.status}`, attempt.status);
      }
      return attempt;
    };
    try {
      if (!retry) {
        return await attemptOnce();
      }
      // Idempotent read: at most one retry for network faults and 5xx.
      return await withRetry(attemptOnce, {
        isTransient: (error) =>
          !(error instanceof DSpaceRequestError) ||
          error.status === undefined ||
          error.status >= 500,
      });
    } catch (cause) {
      if (cause instanceof DSpaceRequestError) {
        throw tagged(cause, operation);
      }
      const wrapped = new DSpaceRequestError(
        cause instanceof Error ? cause.message : "DSpace request failed",
      );
      if (cause instanceof Error && cause.name === "TimeoutError") {
        wrapped.name = "DSpaceTimeoutError";
      }
      throw tagged(wrapped, operation);
    }
  }
}

function tagged(error: DSpaceRequestError, operation: DSpaceOperation): DSpaceRequestError {
  error.operation ??= operation;
  return error;
}

// ─── Public_Record gate (Requirements 2.4, 9.3-9.5) ─────────────────────────

function passesPublicGate(item: Record<string, unknown>): boolean {
  return (
    item.type === "item" &&
    typeof item.uuid === "string" &&
    item.inArchive === true &&
    item.discoverable === true &&
    item.withdrawn === false
  );
}

// ─── Normalization (Requirements 2.5, 4) ────────────────────────────────────

function normalizeItem(
  item: Record<string, unknown>,
  context: {
    files: PublicFileSummary[];
    fileCount: number;
    formats: string[];
    filesStatus: FilesStatus;
    publicBaseUrl: URL;
  },
): ItemDetail {
  const metadata = (item.metadata ?? {}) as DspaceMetadata;
  const handle = typeof item.handle === "string" ? item.handle : null;
  const title =
    firstValue(metadata, "dc.title") ?? (typeof item.name === "string" ? item.name : "Untitled");

  const creators: Creator[] = [
    ...allValues(metadata, "dc.contributor.author"),
    ...allValues(metadata, "dc.creator"),
  ].map((name) => ({ name, affiliation: null, identifier: null }));

  const landingPageUrl = handle
    ? new URL(`handle/${handle}`, context.publicBaseUrl).toString()
    : new URL(`items/${String(item.uuid)}`, context.publicBaseUrl).toString();

  const access: AccessInfo = {
    status: context.fileCount > 0 ? "open" : "metadata_only",
    license: firstValue(metadata, "dc.rights"),
    terms: firstValue(metadata, "dc.rights.uri"),
  };

  const record = createRepositoryRecord({
    platformId: String(item.uuid),
    repository: "jscholarship",
    kind: "repository_item",
    title,
    landingPageUrl,
    provenance: {
      platform: "dspace",
      platformRecordId: String(item.uuid),
      canonicalApi: "dspace_rest",
      retrievedAt: new Date().toISOString(),
    },
    creators,
    date: parseDate(firstValue(metadata, "dc.date.issued")),
    abstract: firstValue(metadata, "dc.description.abstract"),
    subjects: allValues(metadata, "dc.subject"),
    resourceTypes: allValues(metadata, "dc.type"),
    persistentId: handle
      ? {
          type: "handle",
          value: handle,
          // JHU's 1774.2 prefix is not registered in the global Handle.net
          // registry (verified 2026-08-04), so the citation-ready URL is the
          // repository's own landing page, which is the persistent public URL.
          url: new URL(`handle/${handle}`, context.publicBaseUrl).toString(),
        }
      : null,
    citation: firstValue(metadata, "dc.identifier.citation"),
    access,
    fileCount: context.fileCount,
    formats: context.formats,
  });
  return createItemDetail(record, context.files, {
    metadata: canonicalMetadata(metadata),
    filesStatus: context.filesStatus,
  });
}

/** Every public metadata field on the item except the withheld ones. */
function canonicalMetadata(metadata: DspaceMetadata): MetadataField[] {
  const fields: MetadataField[] = [];
  for (const [field, entries] of Object.entries(metadata)) {
    if (WITHHELD_METADATA_FIELDS.has(field) || !Array.isArray(entries)) {
      continue;
    }
    fields.push({ field, values: allValues(metadata, field) });
  }
  return fields;
}

function firstValue(metadata: DspaceMetadata, key: string): string | null {
  const entry = metadata[key]?.[0]?.value;
  return typeof entry === "string" && entry.length > 0 ? entry : null;
}

function allValues(metadata: DspaceMetadata, key: string): string[] {
  const entries = metadata[key] ?? [];
  return entries
    .map((entry) => entry.value)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function parseDate(value: string | null): DateValue {
  if (value === null) {
    return { value: null, display: null, precision: "unknown" };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return { value: value.slice(0, 10), display: value.slice(0, 10), precision: "day" };
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    return { value, display: value, precision: "month" };
  }
  if (/^\d{4}$/.test(value)) {
    return { value, display: value, precision: "year" };
  }
  return { value: null, display: value, precision: "unknown" };
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

async function parseJson(response: Response, operation: DSpaceOperation): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw tagged(new DSpaceRequestError("DSpace returned malformed JSON"), operation);
  }
}
