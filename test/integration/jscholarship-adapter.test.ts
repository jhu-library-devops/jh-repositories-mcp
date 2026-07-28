/**
 * Integration Tests: JScholarship Adapter
 *
 * **Validates: Requirements 2, 6, 7, 9.3-9.4, 11.7-11.9, 16.1-16.2**
 *
 * Paired Solr + DSpace REST fixtures drive the full adapter path: candidate
 * search, rank-ordered bounded canonicalization with cursor arithmetic
 * (nextOffset = startOffset + candidatesConsumed), validation-attrition
 * warnings, facets, related discovery, and namespaced-ID resolution.
 */

import { describe, expect, test } from "bun:test";
import { JScholarshipAdapter } from "../../src/adapters/jscholarship/index";
import dspaceBundles from "../fixtures/jscholarship/dspace-rest-bundles.json";
import dspaceItem from "../fixtures/jscholarship/dspace-rest-item.json";
import solrSearch from "../fixtures/jscholarship/solr-search-response.json";

const UUID_1 = "11111111-1111-1111-1111-111111111111";
const UUID_2 = "22222222-2222-2222-2222-222222222222";

/** DSpace REST payload for the second fixture candidate. */
const dspaceItem2 = {
  ...dspaceItem,
  id: UUID_2,
  uuid: UUID_2,
  handle: "1774.2/88888",
  name: "Wetland Bird Population Surveys",
  metadata: {
    ...dspaceItem.metadata,
    "dc.title": [{ value: "Wetland Bird Population Surveys" }],
  },
};

type Route = () => Response;

function makeAdapter(overrides: Record<string, Route> = {}, log: string[] = []) {
  const routes: Record<string, Route> = {
    "POST /solr/search/select": () => json(solrSearch),
    "POST /solr/search/mlt": () => json(solrSearch),
    [`GET /server/api/core/items/${UUID_1}`]: () => json(dspaceItem),
    [`GET /server/api/core/items/${UUID_2}`]: () => json(dspaceItem2),
    [`GET /server/api/core/items/${UUID_1}/bundles?embed=bitstreams`]: () => json(dspaceBundles),
    ...overrides,
  };
  const adapter = new JScholarshipAdapter({
    solrCollectionUrl: "http://solr.internal:8983/solr/search",
    dspaceApiUrl: "http://dspace.internal:8080/server/api",
    publicBaseUrl: "https://jscholarship.library.jhu.edu",
    requestTimeoutMs: 1000,
    canonicalConcurrency: 2,
    fetchFn: async (input, init) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const key = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
      log.push(key);
      const route = routes[key];
      if (!route) {
        return json({ status: 404 }, 404);
      }
      return route();
    },
  });
  return adapter;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A Solr body with `count` synthetic candidate docs, all validating via DSpace. */
function solrBody(uuids: string[], numFound = uuids.length) {
  return {
    response: {
      numFound,
      start: 0,
      docs: uuids.map((uuid) => ({
        "search.resourceid": uuid,
        "search.resourcetype": "Item",
        handle: "1774.2/99999",
      })),
    },
  };
}

describe("search: candidate retrieval + bounded canonicalization", () => {
  test("returns canonically validated records in rank order with sourceRank", async () => {
    const adapter = makeAdapter();
    const page = await adapter.search({ query: "climate", limit: 10, offset: 0 });

    expect(page.repository).toBe("jscholarship");
    expect(page.results.map((r) => r.id)).toEqual([
      `jscholarship:${UUID_1}`,
      `jscholarship:${UUID_2}`,
    ]);
    expect(page.results.map((r) => r.sourceRank)).toEqual([1, 2]);
    expect(page.results[0]?.title).toBe(
      "Climate Adaptation Strategies for Chesapeake Bay Wetlands",
    );
    expect(page.validationOmissions).toBe(0);
    expect(page.totalCandidates).toBe(2);
    // Fixture window (2 docs) is smaller than rows requested → exhausted.
    expect(page.nextOffset).toBeNull();
  });

  test("drops candidates that fail canonical validation and counts omissions", async () => {
    const adapter = makeAdapter({
      [`GET /server/api/core/items/${UUID_2}`]: () => json({ status: 404 }, 404),
    });
    const page = await adapter.search({ query: "climate", limit: 10, offset: 0 });
    expect(page.results.map((r) => r.id)).toEqual([`jscholarship:${UUID_1}`]);
    expect(page.validationOmissions).toBe(1);
    expect(page.results.some((r) => r.id.includes(UUID_2))).toBe(false);
  });

  test("backend faults during validation fail closed as omissions, never Solr-only data", async () => {
    const adapter = makeAdapter({
      [`GET /server/api/core/items/${UUID_2}`]: () => json({}, 500),
    });
    const page = await adapter.search({ query: "climate", limit: 10, offset: 0 });
    expect(page.results.map((r) => r.id)).toEqual([`jscholarship:${UUID_1}`]);
    expect(page.validationOmissions).toBe(1);
  });

  test("nextOffset = startOffset + candidatesConsumed and stops once the page fills", async () => {
    const log: string[] = [];
    const uuids = [UUID_1, UUID_2, UUID_1.replace(/1/g, "3")];
    const adapter = makeAdapter(
      {
        "POST /solr/search/select": () => json(solrBody(uuids, 50)),
      },
      log,
    );
    const page = await adapter.search({ query: "x", limit: 1, offset: 10 });

    expect(page.results).toHaveLength(1);
    // Only the first candidate is consumed; window had more.
    expect(page.nextOffset).toBe(11);
    // Look-ahead may prefetch within the concurrency window (2) but never candidate 3.
    const validationCalls = log.filter((entry) => entry.includes("/core/items/"));
    expect(validationCalls.length).toBeLessThanOrEqual(2);
  });

  test("emits validation_attrition when the window may hide later results", async () => {
    // limit 1 → rows 3. All 3 candidates fail validation; numFound says more exist.
    const uuid3 = UUID_1.replace(/1/g, "3");
    const adapter = makeAdapter({
      "POST /solr/search/select": () => json(solrBody([UUID_1, UUID_2, uuid3], 50)),
      [`GET /server/api/core/items/${UUID_1}`]: () => json({ status: 404 }, 404),
      [`GET /server/api/core/items/${UUID_2}`]: () => json({ status: 404 }, 404),
      [`GET /server/api/core/items/${uuid3}`]: () => json({ status: 404 }, 404),
    });
    const page = await adapter.search({ query: "x", limit: 1, offset: 0 });
    expect(page.results).toHaveLength(0);
    expect(page.validationOmissions).toBe(3);
    expect(page.nextOffset).toBe(3);
    expect(page.warnings.map((w) => w.code)).toContain("validation_attrition");
  });

  test("reports unsupported filters as repository-qualified warnings", async () => {
    const adapter = makeAdapter();
    const page = await adapter.search({
      query: "climate",
      filters: { access: "open" },
      limit: 10,
      offset: 0,
    });
    const codes = page.warnings.map((w) => `${w.repository}:${w.code}`);
    expect(codes).toContain("jscholarship:unsupported_filter");
  });
});

describe("get: canonical resolution by identifier shape", () => {
  test("resolves namespaced IDs through the DSpace client with files expanded", async () => {
    const adapter = makeAdapter();
    const item = await adapter.get({
      repository: "jscholarship",
      type: "namespaced",
      value: `jscholarship:${UUID_1}`,
    });
    expect(item?.id).toBe(`jscholarship:${UUID_1}`);
    expect(item?.files.length).toBeGreaterThan(0);
  });

  test("returns null for foreign-repository and unsupported identifier types", async () => {
    const adapter = makeAdapter();
    expect(await adapter.get({ repository: "jhrdr", type: "uuid", value: UUID_1 })).toBeNull();
    expect(
      await adapter.get({ repository: "jscholarship", type: "doi", value: "10.1234/x" }),
    ).toBeNull();
  });
});

describe("facets", () => {
  test("maps allowlisted concepts and parses Solr facet pairs", async () => {
    const adapter = makeAdapter({
      "POST /solr/search/select": () =>
        json({
          response: { numFound: 2, docs: [] },
          facet_counts: {
            facet_fields: {
              author_filter: ["Smith, Jane A.", 5, "Johnson, Robert K.", 3],
              "dateIssued.year": ["2024", 6, "2023", 2],
            },
          },
        }),
    });
    const result = await adapter.facets({
      query: "wetlands",
      facets: ["creator", "year"],
      limit: 10,
      offset: 0,
    });
    expect(result.facets).toHaveLength(2);
    const creator = result.facets.find((f) => f.facet === "creator");
    expect(creator?.values[0]).toEqual({
      label: "Smith, Jane A.",
      count: 5,
      repositoryBreakdown: { jscholarship: 5 },
    });
  });

  test("skips and warns on unsupported facet concepts instead of failing", async () => {
    const adapter = makeAdapter({
      "POST /solr/search/select": () =>
        json({
          response: { numFound: 0, docs: [] },
          facet_counts: { facet_fields: { subject_filter: [] } },
        }),
    });
    const result = await adapter.facets({
      query: "x",
      facets: ["subject", "repository"],
      limit: 10,
      offset: 0,
    });
    expect(result.facets.map((f) => f.facet)).toEqual(["subject"]);
  });
});

describe("related", () => {
  test("excludes the source record and canonicalizes the rest", async () => {
    const adapter = makeAdapter();
    const source = await adapter.get({
      repository: "jscholarship",
      type: "uuid",
      value: UUID_1,
    });
    if (!source) throw new Error("expected source item");

    const page = await adapter.related(source, { repositories: "all", limit: 5 });
    expect(page.results.map((r) => r.id)).toEqual([`jscholarship:${UUID_2}`]);
    expect(page.results.some((r) => r.id === source.id)).toBe(false);
  });
});
