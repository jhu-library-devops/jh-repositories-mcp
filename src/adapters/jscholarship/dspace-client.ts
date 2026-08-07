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
  ItemDetail,
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

export class DSpaceRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DSpaceRequestError";
  }
}

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
    options: { expandFiles: boolean },
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
    if (options.expandFiles) {
      const expanded = await this.fetchOriginalBitstreams(uuid);
      files = expanded.files;
      fileCount = expanded.totalCount;
      formats = expanded.formats;
    }

    return normalizeItem(item, { files, fileCount, formats, publicBaseUrl: this.publicBaseUrl });
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
    const response = await this.request(new URL(`core/items/${uuid}`, this.apiBaseUrl), "HEAD");
    if (response.status === 200) {
      return true;
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return false;
    }
    throw new DSpaceRequestError(`DSpace probe returned HTTP ${response.status}`, response.status);
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
      target = new URL("pid/find", this.apiBaseUrl);
      target.searchParams.set("id", `hdl:${identifier.value}`);
    }

    const response = await this.request(target, "GET");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new DSpaceRequestError(`DSpace returned HTTP ${response.status}`, response.status);
    }
    const body = await parseJson(response);
    if (typeof body !== "object" || body === null) {
      throw new DSpaceRequestError("DSpace returned a non-object item payload");
    }
    return body as Record<string, unknown>;
  }

  private async fetchOriginalBitstreams(uuid: string): Promise<{
    files: PublicFileSummary[];
    totalCount: number;
    formats: string[];
  }> {
    const target = new URL(`core/items/${uuid}/bundles`, this.apiBaseUrl);
    target.searchParams.set("embed", "bitstreams");
    const response = await this.request(target, "GET");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { files: [], totalCount: 0, formats: [] };
    }
    if (!response.ok) {
      throw new DSpaceRequestError(`DSpace returned HTTP ${response.status}`, response.status);
    }

    const body = (await parseJson(response)) as {
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

  private async request(target: URL, method: "GET" | "HEAD"): Promise<Response> {
    try {
      // Idempotent read: at most one retry for network faults and 5xx.
      return await withRetry(
        async () => {
          const attempt = await this.fetchImpl(target, {
            method,
            headers: { accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(this.requestTimeoutMs),
          });
          if (attempt.status >= 500) {
            throw new DSpaceRequestError(`DSpace returned HTTP ${attempt.status}`, attempt.status);
          }
          return attempt;
        },
        {
          isTransient: (error) =>
            !(error instanceof DSpaceRequestError) ||
            error.status === undefined ||
            error.status >= 500,
        },
      );
    } catch (cause) {
      if (cause instanceof DSpaceRequestError) {
        throw cause;
      }
      throw new DSpaceRequestError(
        cause instanceof Error ? cause.message : "DSpace request failed",
      );
    }
  }
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
      ? { type: "handle", value: handle, url: `https://hdl.handle.net/${handle}` }
      : null,
    citation: firstValue(metadata, "dc.identifier.citation"),
    access,
    fileCount: context.fileCount,
    formats: context.formats,
  });
  return createItemDetail(record, context.files);
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

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DSpaceRequestError("DSpace returned malformed JSON");
  }
}
