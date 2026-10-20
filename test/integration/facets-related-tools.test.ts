/**
 * Integration Tests: list_facets and find_related_items Tool Handlers
 *
 * **Validates: Requirements 6.1-6.6, 7.1-7.6, 9.3, 15.3, 16.2**
 *
 * Cross-repository facet merging (normalized-label merge, display-form
 * selection, count-then-label ordering, 10-value cap), zero-match facet
 * shapes, canonical-first related resolution, cross-repository derivation,
 * source exclusion, and partial-failure behavior.
 */

import { describe, expect, test } from "bun:test";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { ToolFailure } from "../../src/mcp/errors";
import { deriveRelatedTerms, findRelatedItems } from "../../src/mcp/tools/find-related-items";
import { listFacets, mergeFacetValues, normalizeFacetLabel } from "../../src/mcp/tools/list-facets";
import type { ToolContext } from "../../src/mcp/tools/search-items";
import {
  createItemDetail,
  createRepositoryRecord,
  findRelatedItemsOutputSchema,
  listFacetsOutputSchema,
} from "../../src/models/index";
import type {
  FacetValue,
  ItemDetail,
  RepositoryFacets,
  RepositoryId,
  RepositoryPage,
  RepositorySearchRequest,
} from "../../src/models/index";
import type { BackendFaultLog } from "../../src/observability/index";

// ─── Stubs ───────────────────────────────────────────────────────────────────

function summary(repository: RepositoryId, rank: number) {
  return {
    ...createRepositoryRecord({
      platformId: `${repository}-rel-${rank}`,
      repository,
      kind: repository === "jscholarship" ? ("repository_item" as const) : ("dataset" as const),
      title: `${repository} related ${rank}`,
      landingPageUrl: "https://example.jhu.edu/x",
      provenance: {
        platform: repository === "jscholarship" ? "dspace" : "dataverse",
        platformRecordId: `${repository}-rel-${rank}`,
        canonicalApi: repository === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
        retrievedAt: "2026-07-29T00:00:00.000Z",
      },
    }),
    sourceRank: rank,
  };
}

function sourceItem(): ItemDetail {
  const record = createRepositoryRecord({
    platformId: "11111111-1111-1111-1111-111111111111",
    repository: "jscholarship",
    kind: "repository_item",
    title: "Chesapeake Wetlands Study",
    landingPageUrl: "https://example.jhu.edu/handle/1774.2/99999",
    provenance: {
      platform: "dspace",
      platformRecordId: "11111111-1111-1111-1111-111111111111",
      canonicalApi: "dspace_rest",
      retrievedAt: "2026-07-29T00:00:00.000Z",
    },
    creators: [{ name: "Smith, Jane", affiliation: null, identifier: null }],
    subjects: ["Wetlands", "Climate"],
  });
  return createItemDetail(record, []);
}

interface Behavior {
  facetsResult?: RepositoryFacets | Error;
  getResult?: ItemDetail | null | Error;
  relatedPage?: RepositoryPage;
  relatedError?: Error;
  searchPage?: (request: RepositorySearchRequest) => RepositoryPage;
}

function stub(repository: RepositoryId, behavior: Behavior = {}): RepositoryAdapter {
  const emptyPage = (): RepositoryPage => ({
    repository,
    results: [],
    nextOffset: null,
    totalCandidates: 0,
    validationOmissions: 0,
    warnings: [],
  });
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
    async search(request) {
      return behavior.searchPage ? behavior.searchPage(request) : emptyPage();
    },
    async get() {
      if (behavior.getResult instanceof Error) {
        throw behavior.getResult;
      }
      return behavior.getResult ?? null;
    },
    async facets() {
      if (behavior.facetsResult instanceof Error) {
        throw behavior.facetsResult;
      }
      return behavior.facetsResult ?? { repository, facets: [], totalMatches: 0, warnings: [] };
    },
    async related() {
      if (behavior.relatedError) {
        throw behavior.relatedError;
      }
      return behavior.relatedPage ?? emptyPage();
    },
  };
}

function context(js: Behavior = {}, dv: Behavior = {}): ToolContext {
  return {
    adapters: new Map<RepositoryId, RepositoryAdapter>([
      ["jscholarship", stub("jscholarship", js)],
      ["jhrdr", stub("jhrdr", dv)],
    ]),
  };
}

// ─── list_facets ─────────────────────────────────────────────────────────────

describe("list_facets: cross-repository merging", () => {
  test("merges values only when labels normalize identically; display form wins by frequency", () => {
    const values: FacetValue[] = [
      { label: "Environmental Science", count: 5, repositoryBreakdown: { jscholarship: 5 } },
      { label: "environmental science.", count: 3, repositoryBreakdown: { jhrdr: 3 } },
      { label: "Environmental  Science", count: 1, repositoryBreakdown: { jhrdr: 1 } },
      { label: "Oceanography", count: 4, repositoryBreakdown: { jhrdr: 4 } },
    ];
    const merged = mergeFacetValues(values);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      label: "Environmental Science",
      count: 9,
      repositoryBreakdown: { jscholarship: 5, jhrdr: 4 },
    });
    expect(merged[1]?.label).toBe("Oceanography");
  });

  test("normalization case-folds, collapses whitespace, and strips punctuation", () => {
    expect(normalizeFacetLabel("  Environmental   Science!  ")).toBe("environmental science");
    expect(normalizeFacetLabel("U.S. Housing-Policy")).toBe("us housingpolicy");
  });

  test("caps at 10 values ordered by count desc then label asc", () => {
    const values: FacetValue[] = Array.from({ length: 15 }, (_, i) => ({
      label: `Subject ${String.fromCharCode(65 + i)}`,
      count: i < 5 ? 7 : 4,
    }));
    const merged = mergeFacetValues(values);
    expect(merged).toHaveLength(10);
    expect(merged[0]?.count).toBe(7);
    const tied = merged.filter((v) => v.count === 7).map((v) => v.label);
    expect(tied).toEqual([...tied].sort());
  });

  test("returns requested facet names with empty arrays on zero matches, plus schema conformance", async () => {
    const output = await listFacets(context(), {
      query: "zzz",
      repositories: "all",
      facets: ["subject", "year"],
    });
    expect(output.facets.map((f) => f.facet)).toEqual(["subject", "year"]);
    expect(output.facets.every((f) => f.values.length === 0)).toBe(true);
    expect(() => listFacetsOutputSchema.parse(output)).not.toThrow();
  });

  test("one failed repository yields partial facets and a sanitized warning", async () => {
    const jsFacets: RepositoryFacets = {
      repository: "jscholarship",
      facets: [
        {
          facet: "subject",
          values: [{ label: "Wetlands", count: 2, repositoryBreakdown: { jscholarship: 2 } }],
        },
      ],
      totalMatches: 2,
      warnings: [],
    };
    const output = await listFacets(
      context({ facetsResult: jsFacets }, { facetsResult: new Error("ECONNREFUSED 10.1.2.3") }),
      { query: "wetlands", repositories: "all", facets: ["subject"] },
    );
    expect(output.repositories.failed).toEqual(["jhrdr"]);
    expect(output.facets[0]?.values[0]?.label).toBe("Wetlands");
    const warning = output.warnings.find((w) => w.code === "backend_unavailable");
    expect(warning?.message).not.toContain("10.1.2.3");
  });

  test("the repository facet counts each repository's matching records", async () => {
    const js: RepositoryFacets = {
      repository: "jscholarship",
      facets: [],
      totalMatches: 1234,
      warnings: [],
    };
    const dv: RepositoryFacets = { repository: "jhrdr", facets: [], totalMatches: 0, warnings: [] };
    const output = await listFacets(context({ facetsResult: js }, { facetsResult: dv }), {
      repositories: "all",
      facets: ["repository"],
    });
    expect(output.facets[0]?.values).toEqual([
      { label: "jscholarship", count: 1234, repositoryBreakdown: { jscholarship: 1234 } },
      { label: "jhrdr", count: 0, repositoryBreakdown: { jhrdr: 0 } },
    ]);
  });

  test("a failed repository is logged for operators with the Solr status", async () => {
    const solrDown = Object.assign(new Error("Solr returned HTTP 404 at 10.1.2.3"), {
      name: "SolrRequestError",
      status: 404,
      operation: "solr_select",
    });
    const faults: BackendFaultLog[] = [];
    const ctx = {
      ...context({}, { facetsResult: solrDown }),
      onBackendFault: (fault: BackendFaultLog) => faults.push(fault),
    };
    const output = await listFacets(ctx, { repositories: "all", facets: ["subject"] });
    expect(output.repositories.failed).toEqual(["jhrdr"]);
    expect(faults).toEqual([
      expect.objectContaining({
        tool: "list_facets",
        repository: "jhrdr",
        operation: "solr_select",
        status: 404,
        effect: "partial_results",
      }),
    ]);
    expect(JSON.stringify(faults)).not.toContain("10.1.2.3");
  });

  test("an unconfigured repository is named, with what this server does offer", async () => {
    const jscholarshipOnly: ToolContext = {
      adapters: new Map<RepositoryId, RepositoryAdapter>([["jscholarship", stub("jscholarship")]]),
    };
    const error = await listFacets(jscholarshipOnly, { repositories: "jhrdr" }).then(
      () => null,
      (e: ToolFailure) => e.toolError,
    );
    expect(error).toEqual({
      code: "invalid_input",
      message: "JHRDR is not available on this server. Available here: JScholarship.",
    });
  });

  test("all repositories failing throws backend_unavailable", async () => {
    const boom = { facetsResult: new Error("down") };
    await expect(
      listFacets(context(boom, boom), { query: "x", repositories: "all", facets: ["subject"] }),
    ).rejects.toThrow(ToolFailure);
  });
});

// ─── find_related_items ──────────────────────────────────────────────────────

describe("find_related_items: canonical-first related discovery", () => {
  test("a failing related query is logged with its cause; the client sees only the opaque error", async () => {
    const faults: BackendFaultLog[] = [];
    const ctx = {
      ...context({
        getResult: sourceItem(),
        relatedError: Object.assign(new Error("Solr returned HTTP 404"), {
          name: "SolrRequestError",
          status: 404,
          operation: "solr_select",
        }),
      }),
      onBackendFault: (fault: BackendFaultLog) => faults.push(fault),
    };
    const code = await findRelatedItems(ctx, {
      repository: "jscholarship",
      identifier: "jscholarship:11111111-1111-1111-1111-111111111111",
      targetRepositories: "jscholarship",
      limit: 5,
    }).then(
      () => null,
      (e: ToolFailure) => e.toolError.code,
    );
    expect(code).toBe("backend_unavailable");
    expect(faults).toEqual([
      expect.objectContaining({
        tool: "find_related_items",
        repository: "jscholarship",
        operation: "solr_select",
        status: 404,
        effect: "backend_unavailable",
      }),
    ]);
  });

  test("resolves the source canonically, uses native related in-repo and derived search cross-repo", async () => {
    const requests: string[] = [];
    const output = await findRelatedItems(
      context(
        {
          getResult: sourceItem(),
          relatedPage: {
            repository: "jscholarship",
            results: [summary("jscholarship", 1)],
            nextOffset: null,
            totalCandidates: 1,
            validationOmissions: 0,
            warnings: [],
          },
        },
        {
          searchPage: (request) => {
            requests.push(request.query);
            return {
              repository: "jhrdr",
              results: [summary("jhrdr", 1)],
              nextOffset: null,
              totalCandidates: 1,
              validationOmissions: 0,
              warnings: [],
            };
          },
        },
      ),
      {
        repository: "jscholarship",
        identifier: "1774.2/99999",
        targetRepositories: "all",
        limit: 5,
      },
    );

    expect(output.source.title).toBe("Chesapeake Wetlands Study");
    expect(new Set(output.results.map((r) => r.repository)).size).toBe(2);
    // Cross-repo query is derived from canonical metadata only.
    expect(requests[0]).toContain("Chesapeake Wetlands Study");
    expect(requests[0]).toContain("Smith, Jane");
    expect(() => findRelatedItemsOutputSchema.parse(output)).not.toThrow();
  });

  test("derived terms come from title, creators, and subjects, bounded in length", () => {
    const longSource = {
      ...sourceItem(),
      title: "T".repeat(600),
    };
    const terms = deriveRelatedTerms(longSource);
    expect(terms.length).toBeLessThanOrEqual(400);
    expect(terms.startsWith("TTT")).toBe(true);
  });

  test("a non-public or nonexistent source yields the standard not_found", async () => {
    const failure = await findRelatedItems(context({ getResult: null }), {
      repository: "jscholarship",
      identifier: "1774.2/99999",
      targetRepositories: "all",
      limit: 5,
    }).then(
      () => null,
      (e: ToolFailure) => e.toolError.code,
    );
    expect(failure).toBe("not_found");
  });

  test("excludes the source record and returns a non-error empty result set when nothing relates", async () => {
    const src = sourceItem();
    const output = await findRelatedItems(
      context({
        getResult: src,
        relatedPage: {
          repository: "jscholarship",
          results: [],
          nextOffset: null,
          totalCandidates: 0,
          validationOmissions: 0,
          warnings: [],
        },
      }),
      {
        repository: "jscholarship",
        identifier: "1774.2/99999",
        targetRepositories: "jscholarship",
        limit: 5,
      },
    );
    expect(output.results).toEqual([]);
    expect(output.count).toBe(0);
  });
});
