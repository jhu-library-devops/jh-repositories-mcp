/**
 * Unit Tests: Safe Solr Query Layer
 *
 * **Validates: Requirements 1.4, 2.3, 6.1-6.5, 7.2-7.4, 9.1-9.4, 10.1-10.7**
 *
 * Covers the Lucene/Solr value encoder, the structured query builders
 * (search, facet, related), the non-client-accessible immutable-filter step,
 * and the bounded request parameters (rows, start, fl, timeAllowed).
 */

import { describe, expect, test } from "bun:test";
import { jscholarshipProfile } from "../../config/repositories/jscholarship-profile";
import {
  MAX_ROWS,
  MAX_START,
  MAX_TIME_ALLOWED_MS,
  buildFacetQuery,
  buildRelatedQuery,
  buildSearchQuery,
  escapeSolrValue,
} from "../../src/adapters/solr-query";
import type { RepositorySearchRequest } from "../../src/models/index";

const baseRequest: RepositorySearchRequest = {
  query: "baltimore housing",
  limit: 10,
  offset: 0,
};

describe("escapeSolrValue()", () => {
  test("escapes Lucene special characters", () => {
    expect(escapeSolrValue("a+b")).toBe("a\\+b");
    expect(escapeSolrValue("(x OR y)")).toBe("\\(x OR y\\)");
    expect(escapeSolrValue('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeSolrValue("wild*card?")).toBe("wild\\*card\\?");
    expect(escapeSolrValue("field:value")).toBe("field\\:value");
    expect(escapeSolrValue("a/b")).toBe("a\\/b");
  });

  test("escapes backslashes before other characters", () => {
    expect(escapeSolrValue("a\\b")).toBe("a\\\\b");
    expect(escapeSolrValue("a\\:b")).toBe("a\\\\\\:b");
  });

  test("neutralizes local-parameter injection syntax", () => {
    const escaped = escapeSolrValue("{!join from=x to=y}payload");
    expect(escaped).not.toContain("{!");
    expect(escaped).toContain("\\{");
  });

  test("escapes boolean operators as literals", () => {
    expect(escapeSolrValue("a && b")).toBe("a \\&\\& b");
    expect(escapeSolrValue("a || b")).toBe("a \\|\\| b");
  });
});

describe("buildSearchQuery()", () => {
  test("produces an edismax select query with allowlisted qf and boosts", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, baseRequest);
    expect(query.path).toBe("/select");
    expect(query.params.get("defType")).toBe("edismax");
    expect(query.params.get("qf")).toBe("title^4 author^3 subject^2");
    expect(query.params.get("q")).toBe("baltimore housing");
  });

  test("narrows qf when a specific search field is requested", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, {
      ...baseRequest,
      field: "title",
    });
    expect(query.params.get("qf")).toBe("title^4");
  });

  test("escapes hostile query text", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, {
      ...baseRequest,
      query: '{!terms f=read}g0" OR withdrawn:true',
    });
    const q = query.params.get("q") ?? "";
    expect(q).not.toContain("{!");
    expect(q).toContain("\\{");
    expect(q).toContain("\\:");
  });

  test("always appends every immutable public filter", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, baseRequest);
    const fqs = query.params.getAll("fq");
    for (const filter of jscholarshipProfile.immutablePublicFilters) {
      expect(fqs).toContain(filter.fq);
    }
  });

  test("maps list filters through the profile allowlist", () => {
    const { query, appliedFilters } = buildSearchQuery(jscholarshipProfile, {
      ...baseRequest,
      filters: { creators: ["Smith, Jane"], subjects: ["Housing"] },
    });
    const fqs = query.params.getAll("fq");
    // Equality filters use the plain-valued *_keyword fields, not the
    // DSpace-encoded *_filter fields used for faceting.
    expect(fqs).toContain('author_keyword:("Smith, Jane")');
    expect(fqs).toContain('subject_keyword:("Housing")');
    expect(appliedFilters).toContain("creators");
    expect(appliedFilters).toContain("subjects");
  });

  test("builds a bounded date range filter", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, {
      ...baseRequest,
      filters: { dateFrom: "1990", dateTo: "2000-06-15" },
    });
    const fqs = query.params.getAll("fq");
    expect(fqs).toContain('dateIssued_filter:["1990" TO "2000-06-15"]');
  });

  test("reports filters the profile cannot apply instead of guessing", () => {
    const { unsupportedFilters } = buildSearchQuery(jscholarshipProfile, {
      ...baseRequest,
      filters: { access: "open" },
    });
    expect(unsupportedFilters).toContain("access");
  });

  test("rejects malformed date filter values before any I/O", () => {
    expect(() =>
      buildSearchQuery(jscholarshipProfile, {
        ...baseRequest,
        filters: { dateFrom: "not-a-date" },
      }),
    ).toThrow();
  });

  test("sets bounded rows, start, fl, and timeAllowed", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, {
      ...baseRequest,
      limit: 25,
      offset: 30,
    });
    expect(Number(query.params.get("rows"))).toBe(75);
    expect(Number(query.params.get("rows"))).toBeLessThanOrEqual(MAX_ROWS);
    expect(Number(query.params.get("start"))).toBe(30);
    expect(query.params.get("fl")).toBe(jscholarshipProfile.returnFields.join(","));
    const timeAllowed = Number(query.params.get("timeAllowed"));
    expect(timeAllowed).toBeGreaterThan(0);
    expect(timeAllowed).toBeLessThanOrEqual(MAX_TIME_ALLOWED_MS);
  });

  test("rejects an offset beyond the bounded result window", () => {
    expect(() =>
      buildSearchQuery(jscholarshipProfile, { ...baseRequest, offset: MAX_START + 1 }),
    ).toThrow();
  });

  test("maps sort options and defaults to relevance", () => {
    const sorted = buildSearchQuery(jscholarshipProfile, {
      ...baseRequest,
      sort: "date_desc",
    });
    expect(sorted.query.params.get("sort")).toBe("dc.date.issued_dt desc");
    const defaulted = buildSearchQuery(jscholarshipProfile, baseRequest);
    expect(defaulted.query.params.get("sort")).toBe("score desc");
  });

  test("expectedFields matches the profile return fields", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, baseRequest);
    expect([...query.expectedFields].sort()).toEqual([...jscholarshipProfile.returnFields].sort());
  });
});

describe("buildFacetQuery()", () => {
  test("requests only allowlisted facet fields with bounded values", () => {
    const query = buildFacetQuery(jscholarshipProfile, {
      query: "housing",
      facets: ["creator", "year"],
      limit: 10,
      offset: 0,
    });
    expect(query.path).toBe("/select");
    expect(query.params.get("rows")).toBe("0");
    expect(query.params.get("facet")).toBe("true");
    expect(query.params.getAll("facet.field").sort()).toEqual(
      ["author_filter", "dateIssued.year"].sort(),
    );
    expect(query.params.get("facet.limit")).toBe("10");
    for (const filter of jscholarshipProfile.immutablePublicFilters) {
      expect(query.params.getAll("fq")).toContain(filter.fq);
    }
  });

  test("rejects a facet concept missing from the profile before any I/O", () => {
    expect(() =>
      buildFacetQuery(jscholarshipProfile, {
        query: "x",
        facets: ["repository"],
        limit: 10,
        offset: 0,
      }),
    ).toThrow();
  });
});

describe("blank queries", () => {
  test("a blank query matches every public record via q.alt instead of an empty q", () => {
    for (const blank of ["", "   "]) {
      const { query } = buildSearchQuery(jscholarshipProfile, {
        query: blank,
        limit: 5,
        offset: 0,
      });
      expect(query.params.has("q")).toBe(false);
      expect(query.params.get("q.alt")).toBe("*:*");
      for (const filter of jscholarshipProfile.immutablePublicFilters) {
        expect(query.params.getAll("fq")).toContain(filter.fq);
      }
    }
  });

  test("a non-blank query uses q and no q.alt", () => {
    const { query } = buildSearchQuery(jscholarshipProfile, {
      query: "wetlands",
      limit: 5,
      offset: 0,
    });
    expect(query.params.get("q")).toBe("wetlands");
    expect(query.params.has("q.alt")).toBe(false);
  });

  test("facet queries without a query still apply filters over all public records", () => {
    const query = buildFacetQuery(jscholarshipProfile, {
      query: "",
      filters: { dateFrom: "2020", dateTo: "2023" },
      facets: ["year"],
      limit: 10,
      offset: 0,
    });
    expect(query.params.get("q.alt")).toBe("*:*");
    expect(query.params.getAll("facet.field")).toEqual(["dateIssued.year"]);
    expect(query.params.getAll("fq").some((fq) => fq.includes("2020"))).toBe(true);
  });
});

describe("buildRelatedQuery()", () => {
  test("builds a /select MoreLikeThis query over allowlisted related fields", () => {
    const query = buildRelatedQuery(jscholarshipProfile, {
      identityValue: "0a1b2c3d-1111-2222-3333-444455556666",
      limit: 5,
    });
    expect(query.path).toBe("/select");
    expect(query.params.get("mlt")).toBe("true");
    expect(query.params.get("mlt.count")).toBe("15");
    expect(query.params.get("rows")).toBe("1");
    expect(query.params.get("json.nl")).toBe("map");
    expect(query.params.get("q")).toBe(
      'search.resourceid:"0a1b2c3d\\-1111\\-2222\\-3333\\-444455556666"',
    );
    expect(query.params.get("mlt.fl")).toBe(jscholarshipProfile.relatedFields.join(","));
    for (const filter of jscholarshipProfile.immutablePublicFilters) {
      expect(query.params.getAll("fq")).toContain(filter.fq);
    }
  });
});
