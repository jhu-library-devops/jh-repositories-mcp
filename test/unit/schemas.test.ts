/**
 * Schema Validation Unit Tests
 *
 * TDD tests for task 3.2: closed Zod schemas for MCP tool inputs/outputs.
 * Requirements: 1.1-1.7, 5.3, 10.4, 12.4
 */

import { describe, test, expect } from "bun:test";
import {
  searchItemsInputSchema,
  getItemInputSchema,
  listFacetsInputSchema,
  findRelatedItemsInputSchema,
  explainSearchInputSchema,
  filtersSchema,
} from "../../src/models/schemas";

// ─── search_items Input ──────────────────────────────────────────────────────

describe("searchItemsInputSchema", () => {
  test("valid search input passes validation", () => {
    const input = {
      query: "climate change",
      repositories: "all",
      field: "keyword",
      filters: {
        dateFrom: "2020",
        dateTo: "2024-06-15",
        resourceTypes: ["Article"],
        creators: ["Jane Doe"],
        subjects: ["Climate"],
        collections: ["Physics"],
        access: "open",
      },
      sort: "relevance",
      limit: 10,
    };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("unknown properties are rejected at top level", () => {
    const input = { query: "test", unknownProp: "bad" };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("query length > 512 is rejected", () => {
    const input = { query: "x".repeat(513) };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("empty query (length 0) is rejected", () => {
    const input = { query: "" };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("limit is clamped to range 1-25 (rejects 0)", () => {
    const input = { query: "test", limit: 0 };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("limit is clamped to range 1-25 (rejects 26)", () => {
    const input = { query: "test", limit: 26 };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("limit accepts boundary value 1", () => {
    const input = { query: "test", limit: 1 };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("limit accepts boundary value 25", () => {
    const input = { query: "test", limit: 25 };
    const result = searchItemsInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("default values work (repositories defaults to 'all', limit defaults to 10)", () => {
    const input = { query: "test" };
    const result = searchItemsInputSchema.parse(input);
    expect(result.repositories).toBe("all");
    expect(result.limit).toBe(10);
  });

  test("all field enum values are accepted", () => {
    for (const field of ["keyword", "title", "creator", "subject", "abstract"]) {
      const result = searchItemsInputSchema.safeParse({ query: "test", field });
      expect(result.success).toBe(true);
    }
  });

  test("all sort enum values are accepted", () => {
    for (const sort of ["relevance", "date_asc", "date_desc", "title_asc"]) {
      const result = searchItemsInputSchema.safeParse({ query: "test", sort });
      expect(result.success).toBe(true);
    }
  });

  test("all repository selector values are accepted", () => {
    for (const repositories of ["all", "jscholarship", "jhrdr"]) {
      const result = searchItemsInputSchema.safeParse({ query: "test", repositories });
      expect(result.success).toBe(true);
    }
  });

  test("invalid sort value is rejected", () => {
    const result = searchItemsInputSchema.safeParse({ query: "test", sort: "invalid" });
    expect(result.success).toBe(false);
  });

  test("invalid field value is rejected", () => {
    const result = searchItemsInputSchema.safeParse({ query: "test", field: "fulltext" });
    expect(result.success).toBe(false);
  });
});

// ─── Filters Sub-Schema ──────────────────────────────────────────────────────

describe("filtersSchema", () => {
  test("nested filters object rejects unknown properties", () => {
    const filters = { dateFrom: "2020", unknownFilter: "bad" };
    const result = filtersSchema.safeParse(filters);
    expect(result.success).toBe(false);
  });

  test("invalid date format is rejected (dateFrom)", () => {
    const result = filtersSchema.safeParse({ dateFrom: "20-01-2024" });
    expect(result.success).toBe(false);
  });

  test("invalid date format is rejected (dateTo with time)", () => {
    const result = filtersSchema.safeParse({ dateTo: "2024-01-15T00:00:00Z" });
    expect(result.success).toBe(false);
  });

  test("valid partial dates are accepted", () => {
    expect(filtersSchema.safeParse({ dateFrom: "2020" }).success).toBe(true);
    expect(filtersSchema.safeParse({ dateFrom: "2020-06" }).success).toBe(true);
    expect(filtersSchema.safeParse({ dateFrom: "2020-06-15" }).success).toBe(true);
  });

  test("array bounds are enforced (>10 resourceTypes is rejected)", () => {
    const types = Array.from({ length: 11 }, (_, i) => `Type${i}`);
    const result = filtersSchema.safeParse({ resourceTypes: types });
    expect(result.success).toBe(false);
  });

  test("array bounds are enforced (>10 creators is rejected)", () => {
    const creators = Array.from({ length: 11 }, (_, i) => `Creator${i}`);
    const result = filtersSchema.safeParse({ creators });
    expect(result.success).toBe(false);
  });

  test("array bounds are enforced (>20 subjects is rejected)", () => {
    const subjects = Array.from({ length: 21 }, (_, i) => `Subject${i}`);
    const result = filtersSchema.safeParse({ subjects });
    expect(result.success).toBe(false);
  });

  test("array bounds are enforced (>10 collections is rejected)", () => {
    const collections = Array.from({ length: 11 }, (_, i) => `Col${i}`);
    const result = filtersSchema.safeParse({ collections });
    expect(result.success).toBe(false);
  });

  test("all access enum values are accepted", () => {
    expect(filtersSchema.safeParse({ access: "open" }).success).toBe(true);
    expect(filtersSchema.safeParse({ access: "metadata_only" }).success).toBe(true);
  });

  test("invalid access value is rejected", () => {
    expect(filtersSchema.safeParse({ access: "restricted" }).success).toBe(false);
  });
});

// ─── get_item Input ──────────────────────────────────────────────────────────

describe("getItemInputSchema", () => {
  test("valid get_item input passes", () => {
    const input = { repository: "jscholarship", identifier: "550e8400-e29b-41d4-a716-446655440000" };
    const result = getItemInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("invalid repository in get_item is rejected", () => {
    const input = { repository: "unknown", identifier: "abc123" };
    const result = getItemInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("empty identifier is rejected", () => {
    const input = { repository: "jscholarship", identifier: "" };
    const result = getItemInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("identifier > 512 chars is rejected", () => {
    const input = { repository: "jhrdr", identifier: "x".repeat(513) };
    const result = getItemInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("unknown properties are rejected", () => {
    const input = { repository: "jscholarship", identifier: "abc123", extra: true };
    const result = getItemInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("both jscholarship and jhrdr are accepted", () => {
    expect(
      getItemInputSchema.safeParse({ repository: "jscholarship", identifier: "id1" }).success,
    ).toBe(true);
    expect(
      getItemInputSchema.safeParse({ repository: "jhrdr", identifier: "id2" }).success,
    ).toBe(true);
  });
});

// ─── list_facets Input ───────────────────────────────────────────────────────

describe("listFacetsInputSchema", () => {
  test("valid list_facets input passes", () => {
    const input = {
      query: "biology",
      repositories: "jhrdr",
      facets: ["subject", "year", "creator"],
    };
    const result = listFacetsInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("empty query is allowed (optional)", () => {
    const result = listFacetsInputSchema.safeParse({ facets: ["repository"] });
    expect(result.success).toBe(true);
  });

  test("unknown properties are rejected", () => {
    const result = listFacetsInputSchema.safeParse({ query: "test", badField: 1 });
    expect(result.success).toBe(false);
  });

  test("all facet enum values are accepted", () => {
    const facets = ["repository", "creator", "subject", "year", "resourceType", "collection"];
    const result = listFacetsInputSchema.safeParse({ facets });
    expect(result.success).toBe(true);
  });

  test("invalid facet value is rejected", () => {
    const result = listFacetsInputSchema.safeParse({ facets: ["invalid_facet"] });
    expect(result.success).toBe(false);
  });
});

// ─── find_related_items Input ────────────────────────────────────────────────

describe("findRelatedItemsInputSchema", () => {
  test("valid find_related_items input passes", () => {
    const input = {
      repository: "jscholarship",
      identifier: "550e8400-e29b-41d4-a716-446655440000",
      targetRepositories: "all",
      limit: 5,
    };
    const result = findRelatedItemsInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("defaults limit to 5", () => {
    const input = { repository: "jhrdr", identifier: "doi:10.7281/T1/EXAMPLE" };
    const result = findRelatedItemsInputSchema.parse(input);
    expect(result.limit).toBe(5);
  });

  test("unknown properties are rejected", () => {
    const input = { repository: "jhrdr", identifier: "id1", extra: "bad" };
    const result = findRelatedItemsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

// ─── explain_search Input ────────────────────────────────────────────────────

describe("explainSearchInputSchema", () => {
  test("valid explain_search input passes", () => {
    const input = {
      query: "neural networks",
      repositories: "jscholarship",
      field: "abstract",
      sort: "date_desc",
    };
    const result = explainSearchInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("empty query is rejected", () => {
    const result = explainSearchInputSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  test("unknown properties are rejected", () => {
    const result = explainSearchInputSchema.safeParse({ query: "test", debug: true });
    expect(result.success).toBe(false);
  });
});
