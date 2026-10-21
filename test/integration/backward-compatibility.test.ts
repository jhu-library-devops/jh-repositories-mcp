/**
 * Integration Test: Backward Compatibility of the N-Repository Federation
 * (Task 15.3)
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * Drives the ASSEMBLED server — `createRepositoryServer` + `createMcpTransport`
 * over a `ToolContext` holding stub `jscholarship` + `jhrdr` adapters (contract
 * v2) — exactly like `stateless-multitask.test.ts`: a Hono app served by
 * `Bun.serve({ port: 0 })`, tools called over JSON-RPC with the `rpcTo` helper.
 *
 * It confirms the generalization is transparent to an existing MCP client:
 *   1. A stored V1 cursor (`{v:1, queryHash, jsOffset, dvOffset, nextTieSource}`)
 *      is ACCEPTED (not rejected as `invalid_input`) and paginates from the
 *      mapped V2 offsets (`jsOffset → jscholarship`, `dvOffset → jhrdr`); a V1
 *      token whose hash does not match the current query resets to the first
 *      page with a `cursor_reset` warning (Req 9.1).
 *   2. The `repositories` selector forms all/single-string/omitted (and, as a
 *      bonus, the new array form) validate unchanged and report the expected
 *      `repositories.requested` set (Req 9.2).
 *   3. With only `jscholarship` + `jhrdr` registered at equal weights, result
 *      ORDERING, decoded cursor OFFSETS, and WARNING CODES match the current
 *      two-repository implementation — comparing decoded offsets and behavior,
 *      never `retrievedAt` or the opaque cursor bytes (Req 9.3).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { computeQueryHashV2, decodeCursor } from "../../src/federation/index";
import type { CursorV2 } from "../../src/federation/index";
import { createRepositoryServer } from "../../src/mcp/registry";
import type { ToolContext } from "../../src/mcp/tools/search-items";
import { createMcpTransport } from "../../src/mcp/transport";
import { createItemDetail, createRepositoryRecord } from "../../src/models/index";
import type {
  ItemDetail,
  RepositoryId,
  RepositoryPage,
  RepositoryRecord,
  RepositorySearchRequest,
} from "../../src/models/index";
import { deadlineMiddleware, edgeMiddleware } from "../../src/security/index";

// ─── Deterministic, offset-aware stub pages ──────────────────────────────────

/**
 * Backing result counts far larger than any per-repository fetch window, so an
 * adapter never exhausts its page: `search` always returns a full window of
 * records and a non-null `nextOffset`, and pagination is always exercised.
 *
 * The federation service over-fetches each repository: for a default limit of
 * 10 across two repositories the over-fetch ceiling is `3 × 10 × 2 = 60`, under
 * the 150-candidate budget, so each repository is dispatched with a 30-record
 * window. The emitted cursor's per-repository offset is therefore
 * `dispatchedOffset + 30` — the adapter's own `nextOffset`, exactly as the
 * two-repository implementation computed it.
 */
const BACKING_COUNT = 10_000;

/** The over-fetch window the service dispatches per repository at the default limit. */
const FETCH_WINDOW = 30;

function makeRecord(repository: RepositoryId, rank: number, offset: number): RepositoryRecord {
  const platformId = `${repository}-r${offset + rank}`;
  const item: ItemDetail = createItemDetail(
    createRepositoryRecord({
      platformId,
      repository,
      kind: repository === "jscholarship" ? "repository_item" : "dataset",
      title: `${repository} result @${offset}#${rank}`,
      landingPageUrl: "https://example.jhu.edu/x",
      provenance: {
        platform: repository === "jscholarship" ? "dspace" : "dataverse",
        platformRecordId: platformId,
        canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
        retrievedAt: "2026-07-31T00:00:00.000Z",
      },
    }),
    [],
  );
  const { files: _files, ...summary } = item;
  return { ...summary, sourceRank: rank };
}

/**
 * Return a rank-ordered page for `repository` starting at `offset`: records
 * carry 1-based `sourceRank`, and `nextOffset` is non-null until the backing
 * page is exhausted so pagination always advances.
 */
function pageFor(
  repository: RepositoryId,
  request: Pick<RepositorySearchRequest, "limit" | "offset">,
): RepositoryPage {
  const start = request.offset;
  const count = Math.max(0, Math.min(request.limit, BACKING_COUNT - start));
  const results: RepositoryRecord[] = [];
  for (let rank = 1; rank <= count; rank += 1) {
    results.push(makeRecord(repository, rank, start));
  }
  const consumed = start + count;
  return {
    repository,
    results,
    nextOffset: consumed < BACKING_COUNT ? consumed : null,
    totalCandidates: BACKING_COUNT,
    validationOmissions: 0,
    warnings: [],
  };
}

interface StubOptions {
  /** When set, `search` rejects so the adapter is treated as failed/unavailable. */
  readonly failSearch?: boolean;
}

function stubAdapter(repository: RepositoryId, options: StubOptions = {}): RepositoryAdapter {
  return {
    id: repository,
    contractVersion: 2,
    async probePublic() {
      return true;
    },
    async validateSchema() {
      return {
        repository,
        valid: true,
        missingRequired: [],
        missingOptional: [],
        disabledFeatures: [],
      };
    },
    async search(request) {
      if (options.failSearch) {
        throw new Error("backend down");
      }
      return pageFor(repository, request);
    },
    async get() {
      return createItemDetail(
        createRepositoryRecord({
          platformId: `${repository}-item`,
          repository,
          kind: repository === "jscholarship" ? "repository_item" : "dataset",
          title: `${repository} item`,
          landingPageUrl: "https://example.jhu.edu/x",
          provenance: {
            platform: repository === "jscholarship" ? "dspace" : "dataverse",
            platformRecordId: `${repository}-item`,
            canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
            retrievedAt: "2026-07-31T00:00:00.000Z",
          },
        }),
        [],
      );
    },
    async facets() {
      return { repository, facets: [], totalMatches: 0, warnings: [] };
    },
    async related() {
      return {
        repository,
        results: [],
        nextOffset: null,
        totalCandidates: 0,
        validationOmissions: 0,
        warnings: [],
      };
    },
  };
}

// ─── App factory ──────────────────────────────────────────────────────────────

function createApp(options: { jsFails?: boolean } = {}): Hono {
  const context: ToolContext = {
    adapters: new Map<RepositoryId, RepositoryAdapter>([
      ["jscholarship", stubAdapter("jscholarship", { failSearch: options.jsFails })],
      ["jhrdr", stubAdapter("jhrdr")],
    ]),
  };

  const app = new Hono();
  app.use(
    "/mcp/*",
    edgeMiddleware({ allowedHosts: [], allowedOrigins: [], maxBodyBytes: 64 * 1024 }),
  );
  app.use("/mcp/*", deadlineMiddleware(5000));
  app.route(
    "/mcp",
    createMcpTransport({
      serverName: "backward-compat-test",
      serverVersion: "0.0.1",
      createServer: () =>
        createRepositoryServer({ name: "backward-compat-test", version: "0.0.1", context }),
    }),
  );
  return app;
}

// ─── Servers (healthy + jscholarship-down) ────────────────────────────────────

let healthyServer: ReturnType<typeof Bun.serve>;
let jsDownServer: ReturnType<typeof Bun.serve>;
let healthyUrl: string;
let jsDownUrl: string;

beforeAll(() => {
  healthyServer = Bun.serve({ port: 0, fetch: createApp().fetch });
  jsDownServer = Bun.serve({ port: 0, fetch: createApp({ jsFails: true }).fetch });
  healthyUrl = `http://localhost:${healthyServer.port}`;
  jsDownUrl = `http://localhost:${jsDownServer.port}`;
});

afterAll(() => {
  healthyServer.stop(true);
  jsDownServer.stop(true);
});

// ─── JSON-RPC helper (rpcTo pattern) ──────────────────────────────────────────

let nextId = 1;

interface ToolCallResult {
  readonly isError?: boolean;
  readonly structuredContent?: SearchStructuredContent;
  readonly content?: Array<{ readonly type: string; readonly text?: string }>;
}

interface SearchStructuredContent {
  readonly results: Array<{
    readonly repository: RepositoryId;
    readonly sourceRank: number | null;
  }>;
  readonly count: number;
  readonly cursor: string | null;
  readonly repositories: {
    readonly requested: RepositoryId[];
    readonly succeeded: RepositoryId[];
    readonly failed: RepositoryId[];
  };
  readonly warnings: Array<{
    readonly repository: RepositoryId;
    readonly code: string;
    readonly message: string;
  }>;
  readonly retrievedAt: string;
}

async function rpcTo(
  baseUrl: string,
  method: string,
  params?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params: params ?? {} }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  if (body.error) {
    throw new Error(`RPC error: ${JSON.stringify(body.error)}`);
  }
  return body.result ?? {};
}

async function searchCall(baseUrl: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return (await rpcTo(baseUrl, "tools/call", {
    name: "search_items",
    arguments: args,
  })) as ToolCallResult;
}

// ─── V1 cursor fixture helpers (Req 9.1) ──────────────────────────────────────

const IS_REGISTERED = (id: string): boolean => id === "jscholarship" || id === "jhrdr";

interface V1Cursor {
  readonly v: 1;
  readonly queryHash: string;
  readonly jsOffset: number;
  readonly dvOffset: number;
  readonly nextTieSource: RepositoryId;
}

/** base64url-encode a legacy V1 cursor token exactly as a stored v1 client would. */
function encodeV1(cursor: V1Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * The V1 query hash for an `all`-repository query with the default limit — the
 * same hash the current V2 service computes for the equivalent request, so a V1
 * token carrying it maps straight through without a reset (Req 9.1).
 */
function v1MatchingHash(query: string): string {
  return computeQueryHashV2({ query, repositories: "all", limit: 10 });
}

/** Decode an emitted cursor to its offsets/participating/tie fields (never compare bytes). */
function decodeOffsets(encoded: string): CursorV2 {
  const decoded = decodeCursor(encoded, IS_REGISTERED);
  expect(decoded.error).toBeNull();
  expect(decoded.cursor).not.toBeNull();
  return decoded.cursor as CursorV2;
}

function offsetOf(cursor: CursorV2, repository: RepositoryId): number | undefined {
  return cursor.offsets.find(([id]) => id === repository)?.[1];
}

// ═══════════════════════════════════════════════════════════════════════════
// Req 9.1 — A stored V1 cursor paginates correctly
// ═══════════════════════════════════════════════════════════════════════════

describe("15.3 — V1 cursor pagination (Req 9.1)", () => {
  test("a matching-hash V1 cursor is accepted and paginates from the mapped offsets", async () => {
    const query = "legacy cursor query";
    // Stored v1 token: jsOffset → jscholarship, dvOffset → jhrdr.
    const v1: V1Cursor = {
      v: 1,
      queryHash: v1MatchingHash(query),
      jsOffset: 7,
      dvOffset: 13,
      nextTieSource: "jscholarship",
    };

    const result = await searchCall(healthyUrl, { query, cursor: encodeV1(v1) });

    // Accepted, not rejected as invalid_input.
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;

    // Results came from both mapped repositories (pagination proceeded).
    const sources = new Set(structured.results.map((r) => r.repository));
    expect(sources.has("jscholarship")).toBe(true);
    expect(sources.has("jhrdr")).toBe(true);

    // No cursor_reset warning: the hash matched, so the mapped offsets were used.
    expect(structured.warnings.some((w) => w.code === "cursor_reset")).toBe(false);

    // The next cursor advanced each repository from its MAPPED V1 offset by the
    // over-fetch window, confirming jsOffset→jscholarship and dvOffset→jhrdr
    // were honored (not reset to zero): jscholarship resumed at 7 → 7 + window,
    // jhrdr resumed at 13 → 13 + window.
    expect(structured.cursor).not.toBeNull();
    const next = decodeOffsets(structured.cursor as string);
    expect(offsetOf(next, "jscholarship")).toBe(7 + FETCH_WINDOW);
    expect(offsetOf(next, "jhrdr")).toBe(13 + FETCH_WINDOW);
  });

  test("a non-matching-hash V1 cursor resets to the first page with a cursor_reset warning", async () => {
    const v1: V1Cursor = {
      v: 1,
      queryHash: "0123456789abcdef", // deliberately unrelated to the current query
      jsOffset: 20,
      dvOffset: 25,
      nextTieSource: "jhrdr",
    };

    const result = await searchCall(healthyUrl, {
      query: "a completely different query",
      cursor: encodeV1(v1),
    });

    // Accepted (not invalid_input) but reset to the first page.
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;

    // A cursor_reset warning is surfaced (Req 9.1 / 3.7).
    expect(structured.warnings.some((w) => w.code === "cursor_reset")).toBe(true);

    // First-page offsets: each repository resumed from ZERO (not the stored V1
    // offsets of 20 / 25), so the next offset is a clean first-page window
    // rather than 20 + window or 25 + window.
    const next = decodeOffsets(structured.cursor as string);
    expect(offsetOf(next, "jscholarship")).toBe(FETCH_WINDOW);
    expect(offsetOf(next, "jhrdr")).toBe(FETCH_WINDOW);
  });

  test("a V1 cursor is never rejected as invalid_input for being an unsupported version", async () => {
    const query = "version acceptance";
    const v1: V1Cursor = {
      v: 1,
      queryHash: v1MatchingHash(query),
      jsOffset: 0,
      dvOffset: 0,
      nextTieSource: "jhrdr",
    };

    const result = await searchCall(healthyUrl, { query, cursor: encodeV1(v1) });
    expect(result.isError).toBeUndefined();
    // A rejection would arrive as an isError tool result mentioning invalid_input.
    const text = (result.content ?? []).map((c) => c.text ?? "").join(" ");
    expect(text).not.toContain("invalid_input");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Req 9.2 — Selector forms validate unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe("15.3 — repositories selector forms validate unchanged (Req 9.2)", () => {
  test("omitted repositories is treated as 'all'", async () => {
    const result = await searchCall(healthyUrl, { query: "omitted selector" });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;
    expect(structured.repositories.requested).toEqual(["jhrdr", "jscholarship"]);
  });

  test("repositories: 'all' targets both repositories", async () => {
    const result = await searchCall(healthyUrl, {
      query: "all selector",
      repositories: "all",
    });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;
    expect(structured.repositories.requested).toEqual(["jhrdr", "jscholarship"]);
  });

  test("a single-string repository selector targets only that repository", async () => {
    const result = await searchCall(healthyUrl, {
      query: "single selector",
      repositories: "jscholarship",
    });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;
    expect(structured.repositories.requested).toEqual(["jscholarship"]);
    expect(structured.results.every((r) => r.repository === "jscholarship")).toBe(true);
  });

  test("the new array selector form also validates and resolves to its distinct ids", async () => {
    const result = await searchCall(healthyUrl, {
      query: "array selector",
      repositories: ["jhrdr", "jscholarship", "jhrdr"],
    });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;
    expect(structured.repositories.requested).toEqual(["jhrdr", "jscholarship"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Req 9.3 — Equal-weight two-repository parity
// ═══════════════════════════════════════════════════════════════════════════

describe("15.3 — equal-weight two-repository parity (Req 9.3)", () => {
  test("first-page ordering interleaves the two equal-weight repositories by rank", async () => {
    const result = await searchCall(healthyUrl, { query: "parity ordering" });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;

    // Both repositories supply rank-1..N pages at equal weight, so the RRF merge
    // interleaves them: within each successive sourceRank tier both repositories
    // appear before any record of the next tier. This is the ordering the
    // two-repository implementation produced for equal weights.
    expect(structured.results.length).toBe(10);

    const ranks = structured.results.map((r) => r.sourceRank);
    // Ranks are non-decreasing across the merged page (tiered by sourceRank).
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i] ?? 0).toBeGreaterThanOrEqual(ranks[i - 1] ?? 0);
    }
    // Each rank tier contains exactly one record from each repository.
    const tier1 = structured.results.filter((r) => r.sourceRank === 1);
    expect(new Set(tier1.map((r) => r.repository))).toEqual(
      new Set<RepositoryId>(["jhrdr", "jscholarship"]),
    );

    // Every emitted record carries source attribution (Req 4.6, part of parity).
    for (const record of structured.results) {
      expect(record.repository === "jhrdr" || record.repository === "jscholarship").toBe(true);
      expect(typeof record.sourceRank).toBe("number");
    }
  });

  test("the emitted cursor decodes to equal per-repository offsets for equal weights", async () => {
    const result = await searchCall(healthyUrl, { query: "parity offsets" });
    const structured = result.structuredContent as SearchStructuredContent;

    expect(structured.cursor).not.toBeNull();
    const next = decodeOffsets(structured.cursor as string);

    // Both equal-weight repositories were dispatched at offset zero with the
    // same over-fetch window, so each next offset is that window — the same
    // per-repository offset arithmetic the two-repository implementation
    // produced (decoded offsets, never the opaque cursor bytes).
    expect(offsetOf(next, "jscholarship")).toBe(FETCH_WINDOW);
    expect(offsetOf(next, "jhrdr")).toBe(FETCH_WINDOW);
    expect(next.participating).toEqual(["jhrdr", "jscholarship"]);
  });

  test("a clean two-repository success emits no warnings", async () => {
    const result = await searchCall(healthyUrl, { query: "parity warnings" });
    const structured = result.structuredContent as SearchStructuredContent;
    expect(structured.warnings).toEqual([]);
    expect(structured.repositories.succeeded).toEqual(["jhrdr", "jscholarship"]);
    expect(structured.repositories.failed).toEqual([]);
  });

  test("one repository down yields a single backend_unavailable warning and the responder's native order", async () => {
    const result = await searchCall(jsDownUrl, { query: "parity partial" });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as SearchStructuredContent;

    // jscholarship failed; jhrdr succeeded — matching the two-repository
    // partial-result warning codes.
    expect(structured.repositories.succeeded).toEqual(["jhrdr"]);
    expect(structured.repositories.failed).toEqual(["jscholarship"]);
    const backendWarnings = structured.warnings.filter((w) => w.code === "backend_unavailable");
    expect(backendWarnings.length).toBe(1);
    expect(backendWarnings[0]?.repository).toBe("jscholarship");
    // The warning carries no internal cause.
    expect(backendWarnings[0]?.message).not.toContain("backend down");

    // Single responder: native ordering preserved (all from jhrdr, ranks ascending).
    expect(structured.results.every((r) => r.repository === "jhrdr")).toBe(true);
    const ranks = structured.results.map((r) => r.sourceRank ?? 0);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }

    // The emitted cursor omits the failed repository's offset (Req 6.5 parity)
    // and carries only the responding repository's window-advanced offset.
    const next = decodeOffsets(structured.cursor as string);
    expect(offsetOf(next, "jscholarship")).toBeUndefined();
    expect(offsetOf(next, "jhrdr")).toBe(FETCH_WINDOW);
  });
});
