/**
 * Property-Based Tests: Schema Validator — Required-Field Failure and Optional-Field Degradation
 *
 * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
 *
 * Property 1: Removing any single required field always causes validation failure
 * Property 2: Adding extra fields never causes validation failure
 * Property 3: Removing any optional field never causes validation failure
 * Property 4: disabledFeatures length equals missingOptional length
 * Property 5: Dynamic field patterns cover any matching field name
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import {
  validateSolrSchema,
  type FetchFn,
  type SolrSchemaValidatorOptions,
} from "../../src/adapters/solr-schema-validator";
import type { RepositoryProfile } from "../../config/repositories/jscholarship-profile";

// Run 150 cases per property (exceeds the minimum 100 requirement)
const NUM_RUNS = 150;

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Base required fields used across tests */
const BASE_REQUIRED_FIELDS = [
  "search.resourceid",
  "search.resourcetype",
  "search.uniqueid",
  "handle",
  "withdrawn",
  "discoverable",
  "latestVersion",
  "database_status",
  "read",
  "location.comm",
  "location.coll",
] as const;

/** Base optional fields used across tests */
const BASE_OPTIONAL_FIELDS = [
  "dc.title_mlt",
  "dc.contributor.author_mlt",
  "dc.creator_mlt",
  "dc.subject_mlt",
] as const;

/** Create a test profile with specified fields */
function createTestProfile(overrides: Partial<RepositoryProfile> = {}): RepositoryProfile {
  return {
    id: "jscholarship",
    platform: "dspace",
    version: "2024.1",
    solrCollection: "search",
    requiredSchemaFields: [...BASE_REQUIRED_FIELDS],
    optionalSchemaFields: [...BASE_OPTIONAL_FIELDS],
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

/** Create a mock fetch that returns specified static and dynamic fields */
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a non-empty subset of indices to remove from an array */
function subsetIndicesArb(arrayLength: number): fc.Arbitrary<number[]> {
  return fc
    .subarray(
      Array.from({ length: arrayLength }, (_, i) => i),
      { minLength: 1, maxLength: arrayLength },
    );
}

/** Generate random extra field names that won't collide with required/optional fields */
const extraFieldNameArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter((s) =>
    !BASE_REQUIRED_FIELDS.includes(s as typeof BASE_REQUIRED_FIELDS[number]) &&
    !BASE_OPTIONAL_FIELDS.includes(s as typeof BASE_OPTIONAL_FIELDS[number]) &&
    // Avoid patterns that match dynamic fields
    !s.endsWith("_mlt") &&
    !s.endsWith("_filter") &&
    !s.endsWith("_sort"),
  );

// ─── Property 1: Removing any required field causes validation failure ───────

describe("Property 1: Removing any single required field always causes validation failure", () => {
  test("removing any subset of required fields makes validation fail and lists them", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        subsetIndicesArb(BASE_REQUIRED_FIELDS.length),
        async (indicesToRemove) => {
          const profile = createTestProfile();

          // All fields present EXCEPT the removed ones
          const removedFields = indicesToRemove.map((i) => BASE_REQUIRED_FIELDS[i]);
          const presentFields = [...BASE_REQUIRED_FIELDS, ...BASE_OPTIONAL_FIELDS]
            .filter((f) => !removedFields.includes(f as typeof BASE_REQUIRED_FIELDS[number]));

          const mockFetch = createMockFetch(presentFields);
          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          // Must be invalid
          expect(result.valid).toBe(false);

          // Every removed required field must appear in missingRequired
          for (const removed of removedFields) {
            expect(result.missingRequired).toContain(removed);
          }

          // missingRequired length matches removal count
          expect(result.missingRequired).toHaveLength(removedFields.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 2: Adding extra fields never causes validation failure ─────────

describe("Property 2: Adding extra fields never causes validation failure", () => {
  test("any random extra fields beyond required+optional never break validation", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(extraFieldNameArb, { minLength: 1, maxLength: 20 }),
        async (extraFields) => {
          const profile = createTestProfile();

          // All required + optional fields present, plus random extras
          const allFields = [
            ...BASE_REQUIRED_FIELDS,
            ...BASE_OPTIONAL_FIELDS,
            ...extraFields,
          ];

          const mockFetch = createMockFetch(allFields);
          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          // Must be valid — extra fields are harmless
          expect(result.valid).toBe(true);
          expect(result.missingRequired).toEqual([]);
          expect(result.missingOptional).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 3: Removing any optional field never causes validation failure ─

describe("Property 3: Removing any optional field never causes validation failure", () => {
  test("removing any subset of optional fields keeps validation valid", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        subsetIndicesArb(BASE_OPTIONAL_FIELDS.length),
        async (indicesToRemove) => {
          const profile = createTestProfile();

          const removedOptionalFields = indicesToRemove.map((i) => BASE_OPTIONAL_FIELDS[i]);
          const presentFields = [
            ...BASE_REQUIRED_FIELDS,
            ...BASE_OPTIONAL_FIELDS.filter(
              (f) => !removedOptionalFields.includes(f as typeof BASE_OPTIONAL_FIELDS[number]),
            ),
          ];

          const mockFetch = createMockFetch(presentFields);
          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          // Must remain valid
          expect(result.valid).toBe(true);
          expect(result.missingRequired).toEqual([]);

          // missingOptional must contain the omitted fields
          for (const removed of removedOptionalFields) {
            expect(result.missingOptional).toContain(removed);
          }

          // missingOptional length matches what we removed
          expect(result.missingOptional).toHaveLength(removedOptionalFields.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 4: disabledFeatures length equals missingOptional length ───────

describe("Property 4: disabledFeatures length equals missingOptional length", () => {
  test("for any configuration, disabled features count matches missing optional count", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...BASE_OPTIONAL_FIELDS], { minLength: 0, maxLength: BASE_OPTIONAL_FIELDS.length }),
        async (optionalFieldsToKeep) => {
          const profile = createTestProfile();

          const presentFields = [
            ...BASE_REQUIRED_FIELDS,
            ...optionalFieldsToKeep,
          ];

          const mockFetch = createMockFetch(presentFields);
          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          // Must remain valid (all required present)
          expect(result.valid).toBe(true);

          // Core property: disabledFeatures.length === missingOptional.length
          expect(result.disabledFeatures).toHaveLength(result.missingOptional.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 5: Dynamic field patterns cover any matching field name ────────

describe("Property 5: Dynamic field patterns cover any matching field name", () => {
  /** Generate field names ending with _mlt */
  const mltFieldArb = fc.string({ minLength: 1, maxLength: 30 })
    .filter((s) => /^[a-z][a-z0-9.]*$/.test(s))
    .map((s) => `${s}_mlt`);

  /** Generate field names ending with _filter */
  const filterFieldArb = fc.string({ minLength: 1, maxLength: 30 })
    .filter((s) => /^[a-z][a-z0-9.]*$/.test(s))
    .map((s) => `${s}_filter`);

  /** Generate field names ending with _sort */
  const sortFieldArb = fc.string({ minLength: 1, maxLength: 30 })
    .filter((s) => /^[a-z][a-z0-9.]*$/.test(s))
    .map((s) => `${s}_sort`);

  test("fields matching *_mlt pattern are recognized when dynamic pattern exists", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(mltFieldArb, { minLength: 1, maxLength: 5 }),
        async (mltFields) => {
          // Use the generated _mlt fields as the optional schema fields
          const profile = createTestProfile({
            optionalSchemaFields: mltFields,
          });

          // Static fields only have required fields (no _mlt fields present)
          // But dynamic pattern *_mlt exists
          const mockFetch = createMockFetch(
            [...BASE_REQUIRED_FIELDS],
            ["*_mlt"],
          );

          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          // Must be valid — dynamic pattern covers all _mlt fields
          expect(result.valid).toBe(true);
          expect(result.missingOptional).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("fields matching *_filter pattern are recognized when dynamic pattern exists", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(filterFieldArb, { minLength: 1, maxLength: 5 }),
        async (filterFields) => {
          const profile = createTestProfile({
            requiredSchemaFields: [...BASE_REQUIRED_FIELDS, ...filterFields],
            optionalSchemaFields: [],
          });

          // Dynamic pattern *_filter covers all generated filter fields
          const mockFetch = createMockFetch(
            [...BASE_REQUIRED_FIELDS],
            ["*_filter"],
          );

          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          expect(result.valid).toBe(true);
          expect(result.missingRequired).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("fields matching *_sort pattern are recognized when dynamic pattern exists", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(sortFieldArb, { minLength: 1, maxLength: 5 }),
        async (sortFields) => {
          const profile = createTestProfile({
            requiredSchemaFields: [...BASE_REQUIRED_FIELDS, ...sortFields],
            optionalSchemaFields: [],
          });

          // Dynamic pattern *_sort covers all generated sort fields
          const mockFetch = createMockFetch(
            [...BASE_REQUIRED_FIELDS],
            ["*_sort"],
          );

          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          expect(result.valid).toBe(true);
          expect(result.missingRequired).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("fields NOT matching any dynamic pattern are correctly reported as missing", async () => {
    /**
     * **Validates: Requirements 3.2, 6.2, 10.2, 13.9**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(mltFieldArb, { minLength: 1, maxLength: 3 }),
        async (mltFields) => {
          const profile = createTestProfile({
            optionalSchemaFields: mltFields,
          });

          // No dynamic patterns defined — _mlt fields won't be matched
          const mockFetch = createMockFetch(
            [...BASE_REQUIRED_FIELDS],
            [], // no dynamic patterns
          );

          const result = await validateSolrSchema(createOptions(profile, mockFetch));

          // Still valid (optional fields missing don't fail validation)
          expect(result.valid).toBe(true);

          // But they must be reported as missing
          for (const field of mltFields) {
            expect(result.missingOptional).toContain(field);
          }
          expect(result.missingOptional).toHaveLength(mltFields.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
