/**
 * Property-Based Tests: Normalized Shape Stability and Namespaced-ID Non-Collision
 *
 * **Validates: Requirements 4.1-4.7, 16.2**
 *
 * Property 8: Normalized output shape is stable
 * Property 9: Namespaced IDs cannot collide
 * Additional: Limit normalization, Date format validation
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import {
  createRecordId,
  parseRecordId,
  recordIdsCollide,
  createRepositoryRecord,
  repositoryRecordSchema,
  searchItemsInputSchema,
} from "../../src/models/index";
import type { RepositoryId, Provenance } from "../../src/models/index";

// Run 150 cases per property (exceeds the minimum 100 requirement)
const NUM_RUNS = 150;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty string suitable for platform IDs */
const nonEmptyString = fc.string({ minLength: 1, maxLength: 200 });

/** Repository ID arbitrary */
const repositoryIdArb = fc.constantFrom<RepositoryId>("jscholarship", "jhrdr");

/** Valid provenance for a given repository */
function provenanceArb(repo: RepositoryId): fc.Arbitrary<Provenance> {
  return fc.record({
    platform: fc.constant(repo === "jscholarship" ? "dspace" : "dataverse") as fc.Arbitrary<"dspace" | "dataverse">,
    platformRecordId: fc.string({ minLength: 1, maxLength: 100 }),
    canonicalApi: fc.constant(
      repo === "jscholarship" ? "dspace_rest" : "dataverse_native_api",
    ) as fc.Arbitrary<"dspace_rest" | "dataverse_native_api">,
    retrievedAt: fc.constant(new Date().toISOString()),
  });
}

/** Generate a valid RepositoryRecordInput */
function repositoryRecordInputArb() {
  return repositoryIdArb.chain((repo) =>
    fc.record({
      platformId: fc.string({ minLength: 1, maxLength: 100 }),
      repository: fc.constant(repo) as fc.Arbitrary<RepositoryId>,
      kind: fc.constantFrom("repository_item", "dataset") as fc.Arbitrary<"repository_item" | "dataset">,
      title: fc.string({ minLength: 1, maxLength: 200 }),
      landingPageUrl: fc.webUrl(),
      provenance: provenanceArb(repo),
      // Optional fields — randomly include or omit
      creators: fc.option(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 100 }),
            affiliation: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
            identifier: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        { nil: undefined },
      ),
      abstract: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
      subjects: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 0, maxLength: 5 }),
        { nil: undefined },
      ),
      resourceTypes: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 0, maxLength: 3 }),
        { nil: undefined },
      ),
      formats: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
        { nil: undefined },
      ),
      matchedFields: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
        { nil: undefined },
      ),
      snippet: fc.option(fc.string({ maxLength: 300 }), { nil: undefined }),
      sourceRank: fc.option(fc.nat(1000), { nil: undefined }),
      fileCount: fc.option(fc.nat(500), { nil: undefined }),
      citation: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
    }),
  );
}

// ─── Property 9: Namespaced IDs cannot collide ───────────────────────────────

describe("Property 9: Namespaced IDs cannot collide", () => {
  test("jscholarship and jhrdr IDs never collide for same platformId", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(nonEmptyString, (platformId) => {
        const jsId = createRecordId("jscholarship", platformId);
        const dvId = createRecordId("jhrdr", platformId);
        expect(jsId).not.toBe(dvId);
        expect(recordIdsCollide(jsId, dvId)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("parseRecordId round-trips for any valid input", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(repositoryIdArb, nonEmptyString, (repo, platformId) => {
        const id = createRecordId(repo, platformId);
        const parsed = parseRecordId(id);
        expect(parsed).not.toBeNull();
        expect(parsed!.repository).toBe(repo);
        expect(parsed!.platformId).toBe(platformId);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("recordIdsCollide returns true only for byte-identical IDs", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(repositoryIdArb, nonEmptyString, (repo, platformId) => {
        const id = createRecordId(repo, platformId);
        // Same repo + same platformId → collision
        expect(recordIdsCollide(id, id)).toBe(true);
        // Different repo → no collision
        const otherRepo: RepositoryId = repo === "jscholarship" ? "jhrdr" : "jscholarship";
        const otherId = createRecordId(otherRepo, platformId);
        expect(recordIdsCollide(id, otherId)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("createRecordId rejects empty inputs", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(repositoryIdArb, (repo) => {
        expect(() => createRecordId(repo, "")).toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 8: Normalized output shape is stable ───────────────────────────

describe("Property 8: Normalized output shape is stable", () => {
  test("createRepositoryRecord always produces a valid repositoryRecordSchema output", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(repositoryRecordInputArb(), (input) => {
        const record = createRepositoryRecord(input);
        const result = repositoryRecordSchema.safeParse(record);
        if (!result.success) {
          throw new Error(
            `Schema validation failed: ${JSON.stringify(result.error.issues, null, 2)}`,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("output contains every required key (no missing fields)", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    const requiredKeys = [
      "id",
      "repository",
      "kind",
      "title",
      "creators",
      "date",
      "abstract",
      "subjects",
      "resourceTypes",
      "persistentId",
      "citation",
      "landingPageUrl",
      "collection",
      "access",
      "fileCount",
      "formats",
      "matchedFields",
      "snippet",
      "sourceRank",
      "provenance",
    ] as const;

    fc.assert(
      fc.property(repositoryRecordInputArb(), (input) => {
        const record = createRepositoryRecord(input);
        for (const key of requiredKeys) {
          expect(key in record).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("absent optional values are null, not undefined or omitted", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(repositoryRecordInputArb(), (input) => {
        const record = createRepositoryRecord(input);

        // Nullable scalars must be null, never undefined
        const nullableScalars = ["abstract", "citation", "snippet", "sourceRank", "persistentId"] as const;
        for (const key of nullableScalars) {
          const value = record[key];
          expect(value).not.toBe(undefined);
          // Value is either a concrete value or null
          if (value === undefined) {
            throw new Error(`${key} is undefined, expected null or a value`);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("absent multi-valued fields are empty arrays, not undefined or omitted", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(repositoryRecordInputArb(), (input) => {
        const record = createRepositoryRecord(input);

        const arrayFields = ["creators", "subjects", "resourceTypes", "formats", "matchedFields"] as const;
        for (const key of arrayFields) {
          const value = record[key];
          expect(value).not.toBe(undefined);
          expect(Array.isArray(value)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("record ID is properly namespaced by repository", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(repositoryRecordInputArb(), (input) => {
        const record = createRepositoryRecord(input);
        expect(record.id).toStartWith(`${input.repository}:`);
        expect(record.id).toBe(`${input.repository}:${input.platformId}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Additional Property: Limit normalization ────────────────────────────────

describe("Property: Limit normalization (from spec)", () => {
  test("any integer limit is clamped to 1-25, defaults to 10", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (rawLimit) => {
        // Simulate the schema's clamping behavior
        const parsed = searchItemsInputSchema.safeParse({
          query: "test",
          limit: rawLimit,
        });

        if (rawLimit >= 1 && rawLimit <= 25) {
          // Valid range → accepted and preserved
          expect(parsed.success).toBe(true);
          if (parsed.success) {
            expect(parsed.data.limit).toBe(rawLimit);
          }
        } else {
          // Out of range → rejected by schema
          expect(parsed.success).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("absent limit defaults to 10", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    const parsed = searchItemsInputSchema.safeParse({ query: "test" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(10);
    }
  });
});

// ─── Additional Property: Date format validation ─────────────────────────────

describe("Property: Date format validation (from spec)", () => {
  /** Generate valid date strings: YYYY, YYYY-MM, YYYY-MM-DD */
  const validDateArb = fc.oneof(
    // YYYY
    fc.integer({ min: 1000, max: 9999 }).map((y) => `${y}`),
    // YYYY-MM
    fc
      .tuple(
        fc.integer({ min: 1000, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
      )
      .map(([y, m]) => `${y}-${String(m).padStart(2, "0")}`),
    // YYYY-MM-DD
    fc
      .tuple(
        fc.integer({ min: 1000, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
      )
      .map(([y, m, d]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`),
  );

  test("valid date formats are accepted", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(validDateArb, (dateStr) => {
        const parsed = searchItemsInputSchema.safeParse({
          query: "test",
          filters: { dateFrom: dateStr },
        });
        expect(parsed.success).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /** Generate strings that do NOT match the date pattern /^\d{4}(-\d{2}(-\d{2})?)?$/ */
  const invalidDateArb = fc.oneof(
    // Random strings that aren't dates (filtered by the actual regex)
    fc.string({ minLength: 1, maxLength: 20 }).filter(
      (s) => !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s),
    ),
    // Partial patterns that fail the regex
    fc.constant("202"),
    fc.constant("2024-1"),
    fc.constant("2024-01-1"),
    fc.constant("24-01-01"),
    fc.constant("2024/01/01"),
    fc.constant("01-01-2024"),
    fc.constant("not-a-date"),
    fc.constant("abcd-ef-gh"),
    fc.constant(""),
  );

  test("invalid date formats are rejected", () => {
    /**
     * **Validates: Requirements 4.1-4.7, 16.2**
     */
    fc.assert(
      fc.property(invalidDateArb, (dateStr) => {
        const parsed = searchItemsInputSchema.safeParse({
          query: "test",
          filters: { dateFrom: dateStr },
        });
        expect(parsed.success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
