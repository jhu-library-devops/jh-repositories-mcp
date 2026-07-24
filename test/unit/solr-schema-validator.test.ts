/**
 * Solr Schema Validator — Unit Tests
 *
 * Tests the schema validator using injected fetch mocks.
 * Covers required-field failure, optional-field degradation,
 * dynamic field patterns, and network error handling.
 *
 * Requirements: 6.2, 10.7, 13.9
 */

import { describe, expect, test } from "bun:test";
import {
  SolrSchemaError,
  validateSolrSchema,
  type FetchFn,
  type SolrSchemaValidatorOptions,
} from "../../src/adapters/solr-schema-validator";
import type { RepositoryProfile } from "../../config/repositories/jscholarship-profile";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Minimal profile for testing. */
function createTestProfile(
  overrides: Partial<RepositoryProfile> = {},
): RepositoryProfile {
  return {
    id: "jscholarship",
    platform: "dspace",
    version: "2024.1",
    solrCollection: "search",
    requiredSchemaFields: [
      "search.resourceid",
      "search.resourcetype",
      "handle",
      "withdrawn",
      "discoverable",
    ],
    optionalSchemaFields: [
      "dc.title_mlt",
      "dc.subject_mlt",
    ],
    queryFields: {},
    filterFields: {},
    facetFields: {},
    sortFields: {},
    relatedFields: [],
    returnFields: [],
    identityFields: { uuid: "search.resourceid", handle: "handle", resourceType: "search.resourcetype" },
    immutablePublicFilters: [],
    fulltextDecision: { enabled: false, field: "fulltext", rationale: "test", reference: "test" },
    ...overrides,
  } as RepositoryProfile;
}

/** Create a mock fetch that returns specified fields and dynamic fields. */
function createMockFetch(
  staticFields: string[],
  dynamicFields: string[] = [],
): FetchFn {
  return async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/dynamicfields")) {
      return new Response(
        JSON.stringify({
          dynamicFields: dynamicFields.map((name) => ({ name, type: "text_general" })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Default: /fields
    return new Response(
      JSON.stringify({
        fields: staticFields.map((name) => ({ name, type: "text_general" })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function createOptions(
  profile: RepositoryProfile,
  fetchFn: FetchFn,
): SolrSchemaValidatorOptions {
  return {
    schemaUrl: "http://solr.test:8983/solr/search/schema",
    profile,
    timeoutMs: 5000,
    fetchFn,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("validateSolrSchema", () => {
  test("all required fields present → valid: true, empty missingRequired", async () => {
    const profile = createTestProfile();
    const mockFetch = createMockFetch([
      "search.resourceid",
      "search.resourcetype",
      "handle",
      "withdrawn",
      "discoverable",
      "dc.title_mlt",
      "dc.subject_mlt",
    ]);

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.valid).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual([]);
    expect(result.disabledFeatures).toEqual([]);
    expect(result.repository).toBe("jscholarship");
  });

  test("one required field missing → valid: false, missingRequired contains it", async () => {
    const profile = createTestProfile();
    const mockFetch = createMockFetch([
      "search.resourceid",
      "search.resourcetype",
      // "handle" is missing
      "withdrawn",
      "discoverable",
      "dc.title_mlt",
      "dc.subject_mlt",
    ]);

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toEqual(["handle"]);
    expect(result.missingOptional).toEqual([]);
  });

  test("multiple required fields missing → all listed", async () => {
    const profile = createTestProfile();
    const mockFetch = createMockFetch([
      "search.resourceid",
      // "search.resourcetype" missing
      // "handle" missing
      "withdrawn",
      "discoverable",
      "dc.title_mlt",
      "dc.subject_mlt",
    ]);

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain("search.resourcetype");
    expect(result.missingRequired).toContain("handle");
    expect(result.missingRequired).toHaveLength(2);
  });

  test("optional field missing → valid: true, missingOptional and disabledFeatures populated", async () => {
    const profile = createTestProfile();
    const mockFetch = createMockFetch([
      "search.resourceid",
      "search.resourcetype",
      "handle",
      "withdrawn",
      "discoverable",
      // "dc.title_mlt" missing
      "dc.subject_mlt",
    ]);

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.valid).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual(["dc.title_mlt"]);
    expect(result.disabledFeatures).toEqual(["related_records_dc.title"]);
  });

  test("dynamic fields (e.g. *_mlt) are recognized when pattern exists", async () => {
    const profile = createTestProfile({
      optionalSchemaFields: ["dc.title_mlt", "dc.subject_mlt"],
    });

    // Static fields don't include the _mlt fields, but dynamic pattern *_mlt exists
    const mockFetch = createMockFetch(
      [
        "search.resourceid",
        "search.resourcetype",
        "handle",
        "withdrawn",
        "discoverable",
      ],
      ["*_mlt"], // dynamic field pattern
    );

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.valid).toBe(true);
    expect(result.missingOptional).toEqual([]);
    expect(result.disabledFeatures).toEqual([]);
  });

  test("dynamic field pattern prefix match works", async () => {
    const profile = createTestProfile({
      requiredSchemaFields: ["search.resourceid"],
      optionalSchemaFields: ["dc_title_value"],
    });

    const mockFetch = createMockFetch(
      ["search.resourceid"],
      ["dc_*"], // prefix pattern
    );

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.valid).toBe(true);
    expect(result.missingOptional).toEqual([]);
  });

  test("network timeout → throws SolrSchemaError with descriptive message", async () => {
    const profile = createTestProfile();
    const mockFetch: FetchFn = async (_input, init) => {
      // Simulate abort signal triggering
      if (init?.signal) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      throw new Error("Should not reach here");
    };

    const options: SolrSchemaValidatorOptions = {
      schemaUrl: "http://solr.test:8983/solr/search/schema",
      profile,
      timeoutMs: 50,
      fetchFn: mockFetch,
    };

    expect(validateSolrSchema(options)).rejects.toBeInstanceOf(SolrSchemaError);
    expect(validateSolrSchema(options)).rejects.toMatchObject({
      message: expect.stringContaining("timed out"),
    });
  });

  test("invalid JSON response → throws SolrSchemaError", async () => {
    const profile = createTestProfile();
    const mockFetch: FetchFn = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/dynamicfields")) {
        return new Response(JSON.stringify({ dynamicFields: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not json at all {{{", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    };

    const options = createOptions(profile, mockFetch);

    expect(validateSolrSchema(options)).rejects.toBeInstanceOf(SolrSchemaError);
    expect(validateSolrSchema(options)).rejects.toMatchObject({
      message: expect.stringContaining("not valid JSON"),
    });
  });

  test("404 from Solr → throws SolrSchemaError with HTTP status", async () => {
    const profile = createTestProfile();
    const mockFetch: FetchFn = async () => {
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    };

    const options = createOptions(profile, mockFetch);

    expect(validateSolrSchema(options)).rejects.toBeInstanceOf(SolrSchemaError);
    expect(validateSolrSchema(options)).rejects.toMatchObject({
      message: expect.stringContaining("HTTP 404"),
      httpStatus: 404,
    });
  });

  test("500 from Solr → throws SolrSchemaError with HTTP status", async () => {
    const profile = createTestProfile();
    const mockFetch: FetchFn = async () => {
      return new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      });
    };

    const options = createOptions(profile, mockFetch);

    expect(validateSolrSchema(options)).rejects.toBeInstanceOf(SolrSchemaError);
    expect(validateSolrSchema(options)).rejects.toMatchObject({
      message: expect.stringContaining("HTTP 500"),
      httpStatus: 500,
    });
  });

  test("response missing 'fields' array → throws SolrSchemaError", async () => {
    const profile = createTestProfile();
    const mockFetch: FetchFn = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/dynamicfields")) {
        return new Response(JSON.stringify({ dynamicFields: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Valid JSON but wrong structure
      return new Response(JSON.stringify({ schema: { name: "test" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const options = createOptions(profile, mockFetch);

    expect(validateSolrSchema(options)).rejects.toBeInstanceOf(SolrSchemaError);
    expect(validateSolrSchema(options)).rejects.toMatchObject({
      message: expect.stringContaining("missing expected 'fields' array"),
    });
  });

  test("uses the correct profile repository ID in result", async () => {
    const profile = createTestProfile({ id: "jhrdr" });
    const mockFetch = createMockFetch([
      "search.resourceid",
      "search.resourcetype",
      "handle",
      "withdrawn",
      "discoverable",
      "dc.title_mlt",
      "dc.subject_mlt",
    ]);

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.repository).toBe("jhrdr");
  });

  test("all optional fields missing → all disabledFeatures reported", async () => {
    const profile = createTestProfile();
    const mockFetch = createMockFetch([
      "search.resourceid",
      "search.resourcetype",
      "handle",
      "withdrawn",
      "discoverable",
      // No optional _mlt fields present
    ]);

    const result = await validateSolrSchema(createOptions(profile, mockFetch));

    expect(result.valid).toBe(true);
    expect(result.missingOptional).toEqual(["dc.title_mlt", "dc.subject_mlt"]);
    expect(result.disabledFeatures).toHaveLength(2);
    expect(result.disabledFeatures).toContain("related_records_dc.title");
    expect(result.disabledFeatures).toContain("related_records_dc.subject");
  });
});
