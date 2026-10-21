/**
 * Property-Based Tests: Normalized Query Hash (Cursor_V2)
 *
 * Feature: n-repository-federation, Property 3: Query hash sensitivity
 *
 * **Validates: Requirements 3.9, 12.2**
 *
 * The query hash binds a cursor to the search it paginates. These properties
 * assert both directions of its sensitivity contract:
 *   - normalization-equivalent inputs (case, whitespace, NFC, filter/selector
 *     order and duplicates, explicit-default vs omitted sort/limit) produce
 *     identical hashes; and
 *   - inputs that differ in any hashed dimension after normalization produce
 *     differing hashes.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { type HashableRequest, computeQueryHashV2 } from "../../src/federation/query-hash";
import type { RepositoryId, SearchField, SortOption } from "../../src/models/index";

const NUM_RUNS = 200;

const REPOSITORY_IDS: readonly RepositoryId[] = ["jscholarship", "jhrdr"];
const SORT_OPTIONS: readonly SortOption[] = ["relevance", "date_asc", "date_desc", "title_asc"];
const SEARCH_FIELDS: readonly SearchField[] = [
  "keyword",
  "title",
  "creator",
  "subject",
  "abstract",
];

const DEFAULT_SORT: SortOption = "relevance";
const DEFAULT_LIMIT = 10;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty text whose own normalization is stable (lowercase, no edge/inner runs). */
const normalizedTextArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((raw) => raw.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim())
  .filter((value) => value.length > 0);

const repositorySelectorArb: fc.Arbitrary<HashableRequest["repositories"]> = fc.oneof(
  fc.constant<"all">("all"),
  fc.uniqueArray(fc.constantFrom(...REPOSITORY_IDS), { minLength: 1, maxLength: 2 }),
);

const filtersArb: fc.Arbitrary<HashableRequest["filters"]> = fc.record(
  {
    dateFrom: fc.string({ minLength: 1, maxLength: 10 }),
    dateTo: fc.string({ minLength: 1, maxLength: 10 }),
    resourceTypes: fc.uniqueArray(normalizedTextArb, { maxLength: 4 }),
    creators: fc.uniqueArray(normalizedTextArb, { maxLength: 4 }),
    subjects: fc.uniqueArray(normalizedTextArb, { maxLength: 4 }),
    collections: fc.uniqueArray(normalizedTextArb, { maxLength: 4 }),
    access: fc.constantFrom<"open" | "metadata_only">("open", "metadata_only"),
  },
  { requiredKeys: [] },
);

const requestArb: fc.Arbitrary<HashableRequest> = fc.record(
  {
    query: normalizedTextArb,
    repositories: repositorySelectorArb,
    field: fc.constantFrom(...SEARCH_FIELDS),
    filters: filtersArb,
    sort: fc.constantFrom(...SORT_OPTIONS),
    limit: fc.integer({ min: 1, max: 100 }),
  },
  { requiredKeys: ["query", "repositories"] },
);

const WHITESPACE = [" ", "\t", "\n", "  ", " \t "] as const;

/**
 * Produce a casing/whitespace variant of `text` whose normalized form is
 * unchanged. Letters may be upper-cased (lowered by normalization) and
 * leading/trailing whitespace is added (trimmed by normalization); whitespace
 * is only ever *widened* where `text` already has a space, because
 * normalization collapses runs of whitespace but never fuses two words.
 * Inserting whitespace between non-space characters would create a genuinely
 * different normalized string, so it is deliberately avoided here. Choices are
 * drawn from fast-check so shrinking stays deterministic.
 */
function reskin(text: string): fc.Arbitrary<string> {
  const chars = [...text];
  return fc
    .record({
      upper: fc.array(fc.boolean(), {
        minLength: chars.length,
        maxLength: chars.length,
      }),
      interior: fc.array(fc.constantFrom(...WHITESPACE), {
        minLength: chars.length,
        maxLength: chars.length,
      }),
      lead: fc.constantFrom("", ...WHITESPACE),
      trail: fc.constantFrom("", ...WHITESPACE),
    })
    .map(({ upper, interior, lead, trail }) => {
      let out = lead;
      for (let i = 0; i < chars.length; i += 1) {
        const char = chars[i] ?? "";
        // Only an existing space may be rewritten as a (wider) whitespace run.
        out += char === " " ? (interior[i] ?? " ") : upper[i] ? char.toUpperCase() : char;
      }
      return out + trail;
    });
}

// ─── Property 3a: normalization-equivalent inputs hash identically ──────────

describe("Property 3: query hash sensitivity (equivalence)", () => {
  test("case and surrounding/internal whitespace in the query do not change the hash", () => {
    const reskinnedRequestArb = requestArb.chain((request) =>
      reskin(request.query).map((query) => ({ request, query })),
    );
    fc.assert(
      fc.property(reskinnedRequestArb, ({ request, query }) => {
        const reskinned: HashableRequest = { ...request, query };
        expect(computeQueryHashV2(reskinned)).toBe(computeQueryHashV2(request));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("filter array order and duplicates do not change the hash", () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const filters = request.filters;
        if (filters === undefined) {
          return;
        }
        const shuffleArray = (values?: string[]): string[] | undefined =>
          values === undefined ? undefined : [...values].reverse().concat(values[0] ?? []);
        const permuted: HashableRequest = {
          ...request,
          filters: {
            ...filters,
            resourceTypes: shuffleArray(filters.resourceTypes),
            creators: shuffleArray(filters.creators),
            subjects: shuffleArray(filters.subjects),
            collections: shuffleArray(filters.collections),
          },
        };
        expect(computeQueryHashV2(permuted)).toBe(computeQueryHashV2(request));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("repository selector order and duplicates do not change the hash", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...REPOSITORY_IDS), { minLength: 1, maxLength: 2 }),
        normalizedTextArb,
        (ids, query) => {
          const base: HashableRequest = { query, repositories: ids };
          const permuted: HashableRequest = {
            query,
            repositories: [...ids].reverse().concat(ids[0] ?? []),
          };
          expect(computeQueryHashV2(permuted)).toBe(computeQueryHashV2(base));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("explicit default sort/limit hash the same as omitting them", () => {
    fc.assert(
      fc.property(normalizedTextArb, repositorySelectorArb, (query, repositories) => {
        const omitted: HashableRequest = { query, repositories };
        const explicitDefaults: HashableRequest = {
          query,
          repositories,
          sort: DEFAULT_SORT,
          limit: DEFAULT_LIMIT,
        };
        expect(computeQueryHashV2(explicitDefaults)).toBe(computeQueryHashV2(omitted));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the hash is a pure function: equal requests hash equally", () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        expect(computeQueryHashV2({ ...request })).toBe(computeQueryHashV2(request));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("the hash always matches the documented ^[0-9a-f]{16}$ shape", () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        expect(computeQueryHashV2(request)).toMatch(/^[0-9a-f]{16}$/);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 3b: genuinely different normalized inputs hash differently ────

describe("Property 3: query hash sensitivity (divergence)", () => {
  test("a different normalized query changes the hash", () => {
    fc.assert(
      fc.property(requestArb, normalizedTextArb, (request, otherQuery) => {
        fc.pre(otherQuery !== request.query);
        const changed: HashableRequest = { ...request, query: otherQuery };
        expect(computeQueryHashV2(changed)).not.toBe(computeQueryHashV2(request));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("a different non-default sort changes the hash", () => {
    fc.assert(
      fc.property(
        normalizedTextArb,
        repositorySelectorArb,
        fc.constantFrom(...SORT_OPTIONS),
        fc.constantFrom(...SORT_OPTIONS),
        (query, repositories, sortA, sortB) => {
          fc.pre(sortA !== sortB);
          const a: HashableRequest = { query, repositories, sort: sortA };
          const b: HashableRequest = { query, repositories, sort: sortB };
          expect(computeQueryHashV2(a)).not.toBe(computeQueryHashV2(b));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("a different non-default limit changes the hash", () => {
    fc.assert(
      fc.property(
        normalizedTextArb,
        repositorySelectorArb,
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (query, repositories, limitA, limitB) => {
          fc.pre(limitA !== limitB);
          const a: HashableRequest = { query, repositories, limit: limitA };
          const b: HashableRequest = { query, repositories, limit: limitB };
          expect(computeQueryHashV2(a)).not.toBe(computeQueryHashV2(b));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("a different repository selection changes the hash", () => {
    fc.assert(
      fc.property(normalizedTextArb, (query) => {
        const all: HashableRequest = { query, repositories: "all" };
        const js: HashableRequest = { query, repositories: ["jscholarship"] };
        const dv: HashableRequest = { query, repositories: ["jhrdr"] };
        const both: HashableRequest = { query, repositories: ["jscholarship", "jhrdr"] };
        const hashes = [all, js, dv, both].map(computeQueryHashV2);
        expect(new Set(hashes).size).toBe(hashes.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test("a different search field changes the hash", () => {
    fc.assert(
      fc.property(
        normalizedTextArb,
        repositorySelectorArb,
        fc.constantFrom(...SEARCH_FIELDS),
        fc.constantFrom(...SEARCH_FIELDS),
        (query, repositories, fieldA, fieldB) => {
          fc.pre(fieldA !== fieldB);
          const a: HashableRequest = { query, repositories, field: fieldA };
          const b: HashableRequest = { query, repositories, field: fieldB };
          expect(computeQueryHashV2(a)).not.toBe(computeQueryHashV2(b));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test("adding a distinct filter value changes the hash", () => {
    fc.assert(
      fc.property(normalizedTextArb, normalizedTextArb, (query, subject) => {
        const without: HashableRequest = { query, repositories: "all" };
        const withSubject: HashableRequest = {
          query,
          repositories: "all",
          filters: { subjects: [subject] },
        };
        expect(computeQueryHashV2(withSubject)).not.toBe(computeQueryHashV2(without));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
