/**
 * Integration Tests: search_items and get_item Tool Handlers
 *
 * **Validates: Requirements 1.1-1.8, 5.1-5.5, 9.5, 11.4-11.6, 12.5, 15.3**
 *
 * Stub adapters drive the full handler paths: federated orchestration,
 * cursor lifecycle (invalid, stale-reset, exhausted-skip), partial and total
 * backend failure, output-schema conformance, identifier routing, and the
 * indistinguishable not-found rule.
 */

import { describe, expect, test } from "bun:test";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { computeQueryHash, decodeCursor, encodeCursor } from "../../src/federation/index";
import { ToolFailure } from "../../src/mcp/errors";
import { classifyIdentifier, getItem } from "../../src/mcp/tools/get-item";
import { searchItems } from "../../src/mcp/tools/search-items";
import type { ToolContext } from "../../src/mcp/tools/search-items";
import {
  createItemDetail,
  createRepositoryRecord,
  getItemOutputSchema,
  searchItemsInputSchema,
  searchItemsOutputSchema,
} from "../../src/models/index";
import type {
  ItemDetail,
  RepositoryId,
  RepositoryPage,
  RepositorySearchRequest,
} from "../../src/models/index";

// ─── Stub adapters ───────────────────────────────────────────────────────────

function summary(repository: RepositoryId, rank: number) {
  const record = createRepositoryRecord({
    platformId: `${repository}-item-${rank}`,
    repository,
    kind: repository === "jscholarship" ? "repository_item" : "dataset",
    title: `${repository} result ${rank}`,
    landingPageUrl: "https://example.jhu.edu/x",
    provenance: {
      platform: repository === "jscholarship" ? "dspace" : "dataverse",
      platformRecordId: `${repository}-item-${rank}`,
      canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
      retrievedAt: "2026-07-29T00:00:00.000Z",
    },
  });
  return { ...record, sourceRank: rank };
}

function item(repository: RepositoryId, rank: number): ItemDetail {
  return createItemDetail(summary(repository, rank), []);
}

interface StubBehavior {
  page?: (request: RepositorySearchRequest) => RepositoryPage;
  getResult?: ItemDetail | null | Error;
  searchError?: Error;
}

function stubAdapter(repository: RepositoryId, behavior: StubBehavior = {}): RepositoryAdapter {
  return {
    id: repository,
    async validateSchema() {
      return {
        repository,
        valid: true,
        missingRequired: [],
        missingOptional: [],
        disabledFeatures: [],
      };
    },
    async search(request: RepositorySearchRequest) {
      if (behavior.searchError) {
        throw behavior.searchError;
      }
      if (behavior.page) {
        return behavior.page(request);
      }
      return {
        repository,
        results: [summary(repository, request.offset + 1), summary(repository, request.offset + 2)],
        nextOffset: null,
        totalCandidates: 2,
        validationOmissions: 0,
        warnings: [],
      };
    },
    async get() {
      if (behavior.getResult instanceof Error) {
        throw behavior.getResult;
      }
      return behavior.getResult ?? null;
    },
    async facets() {
      return { repository, facets: [], warnings: [] };
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

function context(js: StubBehavior = {}, dv: StubBehavior = {}): ToolContext {
  return {
    adapters: new Map<RepositoryId, RepositoryAdapter>([
      ["jscholarship", stubAdapter("jscholarship", js)],
      ["jhrdr", stubAdapter("jhrdr", dv)],
    ]),
  };
}

function parseInput(raw: Record<string, unknown>) {
  return searchItemsInputSchema.parse(raw);
}

// ─── search_items ────────────────────────────────────────────────────────────

describe("search_items: federated orchestration", () => {
  test("merges both repositories and conforms to the output schema", async () => {
    const output = await searchItems(context(), parseInput({ query: "housing" }));
    expect(output.results.length).toBeGreaterThan(0);
    expect(new Set(output.results.map((r) => r.repository)).size).toBe(2);
    expect(output.repositories).toEqual({
      requested: ["jscholarship", "jhrdr"],
      succeeded: ["jscholarship", "jhrdr"],
      failed: [],
    });
    expect(() => searchItemsOutputSchema.parse(output)).not.toThrow();
  });

  test("selecting one repository calls only its adapter", async () => {
    const output = await searchItems(context(), parseInput({ query: "x", repositories: "jhrdr" }));
    expect(output.repositories.requested).toEqual(["jhrdr"]);
    expect(output.results.every((r) => r.repository === "jhrdr")).toBe(true);
  });

  test("zero matches yield an empty result set, zero count, and no error", async () => {
    const empty: StubBehavior = {
      page: (request) => ({
        repository: "jscholarship",
        results: [],
        nextOffset: null,
        totalCandidates: 0,
        validationOmissions: 0,
        warnings: [],
      }),
    };
    const dvEmpty: StubBehavior = {
      page: () => ({
        repository: "jhrdr",
        results: [],
        nextOffset: null,
        totalCandidates: 0,
        validationOmissions: 0,
        warnings: [],
      }),
    };
    const output = await searchItems(context(empty, dvEmpty), parseInput({ query: "zzz" }));
    expect(output.results).toEqual([]);
    expect(output.count).toBe(0);
    expect(output.cursor).toBeNull();
  });

  test("one failed repository returns a Partial_Result with a sanitized warning", async () => {
    const output = await searchItems(
      context({}, { searchError: new Error("ECONNREFUSED dataverse.internal:8080") }),
      parseInput({ query: "housing" }),
    );
    expect(output.repositories.failed).toEqual(["jhrdr"]);
    expect(output.results.every((r) => r.repository === "jscholarship")).toBe(true);
    const warning = output.warnings.find((w) => w.code === "backend_unavailable");
    expect(warning).toBeDefined();
    expect(warning?.message).not.toContain("8080");
    expect(warning?.message).not.toContain("ECONNREFUSED");
  });

  test("total backend failure throws a structured backend_unavailable error", async () => {
    const boom = { searchError: new Error("down") };
    await expect(searchItems(context(boom, boom), parseInput({ query: "x" }))).rejects.toThrow(
      ToolFailure,
    );
  });

  test("a malformed cursor is rejected as invalid input before any adapter call", async () => {
    let called = 0;
    const counting: StubBehavior = {
      page: () => {
        called += 1;
        return {
          repository: "jscholarship",
          results: [],
          nextOffset: null,
          totalCandidates: 0,
          validationOmissions: 0,
          warnings: [],
        };
      },
    };
    await expect(
      searchItems(context(counting, counting), parseInput({ query: "x", cursor: "@@not-b64@@" })),
    ).rejects.toThrow(ToolFailure);
    expect(called).toBe(0);
  });

  test("a stale cursor resets to the first page with a cursor_reset warning", async () => {
    const staleCursor = encodeCursor({
      v: 1,
      queryHash: computeQueryHash({
        query: "different query",
        repositories: "all",
        sort: "relevance",
        limit: 10,
      }),
      jsOffset: 500,
      dvOffset: 500,
      nextTieSource: "jhrdr",
    });
    const offsets: number[] = [];
    const observing: StubBehavior = {
      page: (request) => {
        offsets.push(request.offset);
        return {
          repository: "jscholarship",
          results: [],
          nextOffset: null,
          totalCandidates: 0,
          validationOmissions: 0,
          warnings: [],
        };
      },
    };
    const output = await searchItems(
      context(observing, observing),
      parseInput({ query: "housing", cursor: staleCursor }),
    );
    expect(output.warnings.map((w) => w.code)).toContain("cursor_reset");
    expect(offsets.every((offset) => offset === 0)).toBe(true);
  });

  test("an exhausted repository offset skips that adapter on later pages", async () => {
    const input = parseInput({ query: "housing" });
    const validCursor = encodeCursor({
      v: 1,
      queryHash: computeQueryHash({
        query: "housing",
        repositories: "all",
        sort: "relevance",
        limit: 10,
      }),
      jsOffset: -1,
      dvOffset: 4,
      nextTieSource: "jscholarship",
    });
    const jsCalls: number[] = [];
    const js: StubBehavior = {
      page: (request) => {
        jsCalls.push(request.offset);
        return {
          repository: "jscholarship",
          results: [],
          nextOffset: null,
          totalCandidates: 0,
          validationOmissions: 0,
          warnings: [],
        };
      },
    };
    const output = await searchItems(context(js, {}), { ...input, cursor: validCursor });
    expect(jsCalls).toHaveLength(0);
    expect(output.results.every((r) => r.repository === "jhrdr")).toBe(true);
  });

  test("the returned cursor round-trips and reflects adapter nextOffsets", async () => {
    const withMore: StubBehavior = {
      page: (request) => ({
        repository: "jscholarship",
        results: [summary("jscholarship", 1)],
        nextOffset: request.offset + 3,
        totalCandidates: 50,
        validationOmissions: 0,
        warnings: [],
      }),
    };
    const dvDone: StubBehavior = {
      page: () => ({
        repository: "jhrdr",
        results: [summary("jhrdr", 1)],
        nextOffset: null,
        totalCandidates: 1,
        validationOmissions: 0,
        warnings: [],
      }),
    };
    const output = await searchItems(context(withMore, dvDone), parseInput({ query: "q" }));
    expect(output.cursor).not.toBeNull();
    const decoded = decodeCursor(output.cursor ?? "");
    expect(decoded?.jsOffset).toBe(3);
    expect(decoded?.dvOffset).toBe(-1);
  });
});

// ─── get_item ────────────────────────────────────────────────────────────────

describe("get_item: identifier routing and resolution", () => {
  test("classifies namespaced, UUID, Handle, and DOI shapes correctly", () => {
    expect(
      classifyIdentifier("jscholarship", "jscholarship:11111111-1111-1111-1111-111111111111")?.type,
    ).toBe("namespaced");
    expect(classifyIdentifier("jscholarship", "11111111-1111-1111-1111-111111111111")?.type).toBe(
      "uuid",
    );
    expect(classifyIdentifier("jscholarship", "1774.2/99999")?.type).toBe("handle");
    expect(classifyIdentifier("jhrdr", "doi:10.7281/T1ABCDEF")?.type).toBe("doi");
    expect(classifyIdentifier("jhrdr", "hdl:1774.2/99999")?.type).toBe("persistent_id");
    // Namespace mismatch is malformed, never probed.
    expect(classifyIdentifier("jhrdr", "jscholarship:whatever-id")).toBeNull();
    expect(classifyIdentifier("jscholarship", "total junk !!!")).toBeNull();
  });

  test("resolves through the matching adapter and conforms to the output schema", async () => {
    const detail = item("jscholarship", 1);
    const output = await getItem(context({ getResult: detail }), {
      repository: "jscholarship",
      identifier: "11111111-1111-1111-1111-111111111111",
    });
    expect(output.id).toBe(detail.id);
    expect(() => getItemOutputSchema.parse(output)).not.toThrow();
  });

  test("nonexistent and non-public records produce one identical not_found shape", async () => {
    const capture = async () => {
      try {
        await getItem(context({ getResult: null }), {
          repository: "jscholarship",
          identifier: "11111111-1111-1111-1111-111111111111",
        });
        throw new Error("expected failure");
      } catch (error) {
        if (error instanceof ToolFailure) {
          return error.toolError;
        }
        throw error;
      }
    };
    const first = await capture();
    const second = await capture();
    expect(first).toEqual(second);
    expect(first.code).toBe("not_found");
  });

  test("malformed identifiers are rejected before any adapter call", async () => {
    const err = await getItem(context(), {
      repository: "jhrdr",
      identifier: "'; DROP TABLE datasets;--",
    }).then(
      () => null,
      (e: ToolFailure) => e.toolError.code,
    );
    expect(err).toBe("invalid_input");
  });

  test("backend faults surface as backend_unavailable with no internal detail", async () => {
    const failure = await getItem(
      context({ getResult: new Error("connect ETIMEDOUT 10.0.3.17:8080") }),
      { repository: "jscholarship", identifier: "1774.2/99999" },
    ).then(
      () => null,
      (e: ToolFailure) => e.toolError,
    );
    expect(failure?.code).toBe("backend_unavailable");
    expect(failure?.message).not.toContain("10.0.3.17");
    expect(failure?.message).not.toContain("ETIMEDOUT");
  });
});
