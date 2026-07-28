/**
 * Property-Based Tests: Safe Solr Query Layer
 *
 * **Validates: Requirements 9.1-9.4, 10.1-10.7, 16.2**
 *
 * Property 2: Every emitted Solr field is allowlisted
 * Property 3: Immutable public filters are always present
 * Property 4: Unsafe query syntax cannot change structure
 * Property 5: Unknown input fails before I/O
 * Bounds: rows, start, facet limits, and timeAllowed are always bounded
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { jhrdrProfile } from "../../config/repositories/jhrdr-profile";
import { jscholarshipProfile } from "../../config/repositories/jscholarship-profile";
import type { RepositoryProfile } from "../../config/repositories/jscholarship-profile";
import { SolrClient, SolrRequestError } from "../../src/adapters/solr-client";
import {
  MAX_ROWS,
  MAX_START,
  MAX_TIME_ALLOWED_MS,
  UnsafeQueryError,
  buildFacetQuery,
  buildRelatedQuery,
  buildSearchQuery,
} from "../../src/adapters/solr-query";
import type { SearchFilters } from "../../src/models/index";

const NUM_RUNS = 150;

const profiles: RepositoryProfile[] = [jscholarshipProfile, jhrdrProfile];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Query text including hostile Lucene/local-param constructs. */
const hostileText = fc.oneof(
  fc.string({ minLength: 1, maxLength: 300 }),
  fc.constantFrom(
    "{!terms f=read}g0",
    "{!join from=search.resourceid to=handle}x",
    '*:* OR withdrawn:true"',
    "read:g0^100 AND -discoverable:false",
    "a\\b/{c}[d](e)~f?g*h",
    '_val_:"recip(1,2,3)"',
  ),
  fc
    .tuple(fc.string({ maxLength: 40 }), fc.constantFrom("{!", "||", "&&", ":", "\\"))
    .map(([a, b]) => a + b + a),
);

const fieldArb = fc.constantFrom(
  undefined,
  "keyword" as const,
  "title" as const,
  "creator" as const,
  "subject" as const,
  "abstract" as const,
);

const filterListArb = fc.array(fc.string({ minLength: 1, maxLength: 60 }), {
  maxLength: 5,
});

const filtersArb: fc.Arbitrary<SearchFilters | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.record(
    {
      creators: filterListArb,
      subjects: filterListArb,
      collections: filterListArb,
      dateFrom: fc.constantFrom("1990", "2001-06", "2020-01-15"),
      dateTo: fc.constantFrom("1995", "2024-12", "2024-12-31"),
    },
    { requiredKeys: [] },
  ),
);

const limitArb = fc.integer({ min: 1, max: 25 });
const offsetArb = fc.integer({ min: 0, max: MAX_START });

/** Fields legitimately allowed to appear anywhere in an emitted query. */
function allowlistedFields(profile: RepositoryProfile): Set<string> {
  const allowed = new Set<string>();
  for (const weighted of Object.values(profile.queryFields)) {
    for (const { field } of weighted) allowed.add(field);
  }
  for (const field of Object.values(profile.filterFields)) allowed.add(field);
  for (const field of Object.values(profile.facetFields)) allowed.add(field);
  for (const sort of Object.values(profile.sortFields)) allowed.add(sort.field);
  for (const field of profile.relatedFields) allowed.add(field);
  for (const field of profile.returnFields) allowed.add(field);
  allowed.add(profile.identityFields.uuid);
  allowed.add(profile.identityFields.handle);
  allowed.add(profile.identityFields.resourceType);
  for (const filter of profile.immutablePublicFilters) {
    const match = /^-?([A-Za-z0-9._]+):/.exec(filter.fq);
    if (match?.[1] !== undefined) allowed.add(match[1]);
  }
  allowed.add("score");
  return allowed;
}

/** Extracts the field name from an fq clause like `field:(...)` or `-field:x`. */
function fqFieldName(fq: string): string | null {
  const match = /^-?([A-Za-z0-9._]+):/.exec(fq);
  return match?.[1] ?? null;
}

// ─── Property 4: unsafe syntax cannot change structure ──────────────────────

describe("Property 4: unsafe query syntax stays literal", () => {
  test("no unescaped special characters survive in q", () => {
    for (const profile of profiles) {
      fc.assert(
        fc.property(hostileText, (text) => {
          const { query } = buildSearchQuery(profile, {
            query: text,
            limit: 10,
            offset: 0,
          });
          const q = query.params.get("q") ?? "";
          // Every special character must be immediately preceded by a backslash.
          const unescaped = /(?<!\\)[+!(){}[\]^"~*?:/]/.test(q.replace(/\\\\/g, ""));
          expect(unescaped).toBe(false);
          expect(q).not.toContain("{!");
        }),
        { numRuns: NUM_RUNS },
      );
    }
  });

  test("builders never throw on arbitrary printable query text", () => {
    for (const profile of profiles) {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 512 }), limitArb, (text, limit) => {
          const { query } = buildSearchQuery(profile, {
            query: text,
            limit,
            offset: 0,
          });
          expect(query.path).toBe("/select");
        }),
        { numRuns: NUM_RUNS },
      );
    }
  });
});

// ─── Property 3: immutable public filters always present ────────────────────

describe("Property 3: immutable public filters are always present", () => {
  test("search, facet, and related queries all carry the complete filter set", () => {
    for (const profile of profiles) {
      fc.assert(
        fc.property(
          hostileText,
          fieldArb,
          filtersArb,
          limitArb,
          offsetArb,
          (text, field, filters, limit, offset) => {
            const supportedFacets = (["creator", "subject", "year"] as const).filter(
              (concept) => profile.facetFields[concept] !== undefined,
            );
            const built = [
              buildSearchQuery(profile, { query: text, field, filters, limit, offset }).query,
              buildFacetQuery(profile, {
                query: text,
                field,
                filters,
                facets: supportedFacets,
                limit,
                offset: 0,
              }),
              buildRelatedQuery(profile, { identityValue: text, limit }),
            ];
            for (const query of built) {
              const fqs = query.params.getAll("fq");
              for (const filter of profile.immutablePublicFilters) {
                expect(fqs).toContain(filter.fq);
              }
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    }
  });
});

// ─── Property 2: every emitted field is allowlisted ─────────────────────────

describe("Property 2: every emitted Solr field is allowlisted", () => {
  test("qf, fl, sort, fq, and facet.field only reference profile fields", () => {
    for (const profile of profiles) {
      const allowed = allowlistedFields(profile);
      fc.assert(
        fc.property(hostileText, fieldArb, filtersArb, limitArb, (text, field, filters, limit) => {
          const { query } = buildSearchQuery(profile, {
            query: text,
            field,
            filters,
            limit,
            offset: 0,
          });
          for (const qfEntry of (query.params.get("qf") ?? "").split(" ")) {
            const name = qfEntry.split("^")[0];
            if (name) expect(allowed.has(name)).toBe(true);
          }
          for (const flField of (query.params.get("fl") ?? "").split(",")) {
            expect(allowed.has(flField)).toBe(true);
          }
          const sortField = (query.params.get("sort") ?? "").split(" ")[0];
          if (sortField) expect(allowed.has(sortField)).toBe(true);
          for (const fq of query.params.getAll("fq")) {
            const name = fqFieldName(fq);
            expect(name).not.toBeNull();
            if (name) expect(allowed.has(name)).toBe(true);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    }
  });
});

// ─── Property 5 + bounds ─────────────────────────────────────────────────────

describe("Property 5: unknown input fails before I/O", () => {
  test("unknown facet concepts are rejected", () => {
    for (const profile of profiles) {
      expect(() =>
        buildFacetQuery(profile, {
          query: "x",
          facets: ["repository"],
          limit: 10,
          offset: 0,
        }),
      ).toThrow(UnsafeQueryError);
    }
  });

  test("offsets beyond the window and non-positive limits are rejected", () => {
    for (const profile of profiles) {
      fc.assert(
        fc.property(fc.integer({ min: MAX_START + 1, max: MAX_START * 10 }), (offset) => {
          expect(() => buildSearchQuery(profile, { query: "x", limit: 10, offset })).toThrow(
            UnsafeQueryError,
          );
        }),
        { numRuns: 50 },
      );
      expect(() => buildSearchQuery(profile, { query: "x", limit: 0, offset: 0 })).toThrow(
        UnsafeQueryError,
      );
    }
  });
});

describe("Bounds: rows, start, and timeAllowed are always bounded", () => {
  test("rows = 3 × limit capped at MAX_ROWS; timeAllowed ≤ MAX_TIME_ALLOWED_MS", () => {
    for (const profile of profiles) {
      fc.assert(
        fc.property(limitArb, offsetArb, (limit, offset) => {
          const { query } = buildSearchQuery(profile, { query: "x", limit, offset });
          const rows = Number(query.params.get("rows"));
          expect(rows).toBe(Math.min(limit * 3, MAX_ROWS));
          expect(Number(query.params.get("start"))).toBe(offset);
          const timeAllowed = Number(query.params.get("timeAllowed"));
          expect(timeAllowed).toBeGreaterThan(0);
          expect(timeAllowed).toBeLessThanOrEqual(MAX_TIME_ALLOWED_MS);
        }),
        { numRuns: NUM_RUNS },
      );
    }
  });
});

// ─── Client path restriction (Requirement 10.7) ─────────────────────────────

describe("SolrClient path restriction", () => {
  test("refuses non-allowlisted paths and never follows redirects", async () => {
    const seen: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
    const client = new SolrClient(new URL("http://solr.internal:8983/solr/search"), {
      requestTimeoutMs: 1000,
      fetchImpl: async (url, init) => {
        seen.push({ url: url.toString(), redirect: init.redirect });
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const { query } = buildSearchQuery(jscholarshipProfile, {
      query: "x",
      limit: 1,
      offset: 0,
    });
    await client.execute(query);
    expect(seen[0]?.url).toBe("http://solr.internal:8983/solr/search/select");
    expect(seen[0]?.redirect).toBe("error");

    const forged = { ...query, path: "/admin/cores" as unknown as "/select" };
    await expect(client.execute(forged)).rejects.toThrow(SolrRequestError);
  });
});
