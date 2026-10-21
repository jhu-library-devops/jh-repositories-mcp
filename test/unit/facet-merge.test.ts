/**
 * Unit Tests: N-Way Facet Label Normalization and Ordering
 *
 * Feature: n-repository-federation
 *
 * **Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.7**
 *
 * Concrete examples for `mergeFacets` and the exported `normalizeLabel`
 * (src/federation/facet-merge.ts): canonical label normalization (Req 7.1),
 * display-label selection with frequency ties (Req 7.3), the 10-value
 * cap/ordering by count desc then label asc (Req 7.4), the synthetic
 * `repository` facet (Req 7.5), the unsupported-facet path that uses supporting
 * adapters only (Req 7.6), and the all-fail backend-unavailability error
 * (Req 7.7). Property 17 (count conservation) lives in the property suite; these
 * tests pin the specific example behavior those properties do not fix.
 */

import { describe, expect, test } from "bun:test";
import {
  MAX_FACET_VALUES,
  type RepositoryFacetContribution,
  isFacetMergeError,
  mergeFacets,
  normalizeLabel,
} from "../../src/federation/facet-merge";
import type { CommonFacet, FacetResult, FacetValue, RepositoryId } from "../../src/models/index";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build one repository's contribution; `supported` defaults to the facets it returned. */
function contribution(
  repository: RepositoryId,
  facets: readonly FacetResult[],
  options: { totalMatches?: number; supported?: readonly CommonFacet[] } = {},
): RepositoryFacetContribution {
  const supported = options.supported ?? facets.map((result) => result.facet);
  return {
    repository,
    facets,
    totalMatches: options.totalMatches ?? 0,
    supported: new Set<CommonFacet>(supported),
  };
}

/** A content facet result with the given label/count values. */
function facet(
  name: CommonFacet,
  values: readonly { label: string; count: number }[],
): FacetResult {
  return { facet: name, values: values.map((value) => ({ ...value })) };
}

/** Find a merged facet by name; fails the test if it is absent. */
function findFacet(results: readonly FacetResult[], name: CommonFacet): FacetResult {
  const result = results.find((candidate) => candidate.facet === name);
  if (result === undefined) {
    throw new Error(`expected a '${name}' facet in the merged result`);
  }
  return result;
}

/** Assert the result is a merged facet list (not a FacetMergeError) and return it. */
function expectFacets(result: FacetResult[] | { error: unknown }): FacetResult[] {
  if (isFacetMergeError(result as never)) {
    throw new Error("expected merged facets, received a FacetMergeError");
  }
  return result as FacetResult[];
}

// ─── Req 7.1: label normalization ────────────────────────────────────────────

describe("normalizeLabel (Req 7.1)", () => {
  test("case-folds to lowercase", () => {
    expect(normalizeLabel("Machine Learning")).toBe("machine learning");
    expect(normalizeLabel("OPEN ACCESS")).toBe("open access");
  });

  test("collapses internal whitespace to a single space and trims", () => {
    expect(normalizeLabel("Data   Science")).toBe("data science");
    expect(normalizeLabel("  Climate  Change  ")).toBe("climate change");
    expect(normalizeLabel("tab\tseparated")).toBe("tab separated");
  });

  test("removes hyphens without fusing adjacent words", () => {
    expect(normalizeLabel("World - Wide")).toBe("world wide");
    expect(normalizeLabel("machine-learning")).toBe("machine learning");
  });

  test("removes parentheses without fusing adjacent words", () => {
    expect(normalizeLabel("Climate (Science)")).toBe("climate science");
  });

  test("strips trailing periods only (internal periods are preserved)", () => {
    // normalizeLabel removes a trailing period run after trimming; it does not
    // touch internal periods (`/\.+$/`). "Ph.D." case-folds then drops its
    // trailing '.' to "ph.d"; "U.S.A." keeps its internal dots as "u.s.a".
    expect(normalizeLabel("Ph.D.")).toBe("ph.d");
    expect(normalizeLabel("etc.")).toBe("etc");
    expect(normalizeLabel("U.S.A.")).toBe("u.s.a");
    expect(normalizeLabel("Final..")).toBe("final");
  });

  test("labels that normalize identically share a canonical key", () => {
    const canonical = normalizeLabel("Machine Learning");
    expect(normalizeLabel("machine-learning")).toBe(canonical);
    expect(normalizeLabel("Machine  Learning.")).toBe(canonical);
  });
});

// ─── Req 7.3: display-label selection ─────────────────────────────────────────

describe("display-label selection (Req 7.3)", () => {
  test("the most frequent original form wins", () => {
    const results = expectFacets(
      mergeFacets([
        contribution("jscholarship", [facet("subject", [{ label: "Machine Learning", count: 3 }])]),
        contribution("jhrdr", [facet("subject", [{ label: "Machine Learning", count: 2 }])]),
        contribution("jscholarship" as RepositoryId, [
          facet("subject", [{ label: "machine-learning", count: 1 }]),
        ]),
      ]),
    );

    const subject = findFacet(results, "subject");
    expect(subject.values).toHaveLength(1);
    // "Machine Learning" appears twice, "machine-learning" once → most frequent wins.
    expect(subject.values[0]?.label).toBe("Machine Learning");
    expect(subject.values[0]?.count).toBe(6);
  });

  test("a frequency tie breaks to the form that sorts first in ascending Unicode", () => {
    const results = expectFacets(
      mergeFacets([
        contribution("jscholarship", [facet("subject", [{ label: "Open Access", count: 4 }])]),
        contribution("jhrdr", [facet("subject", [{ label: "open access", count: 5 }])]),
      ]),
    );

    const subject = findFacet(results, "subject");
    expect(subject.values).toHaveLength(1);
    // Each form observed once (frequency tie). Uppercase 'O' (U+004F) sorts
    // before lowercase 'o' (U+006F), so "Open Access" is chosen.
    expect(subject.values[0]?.label).toBe("Open Access");
    expect(subject.values[0]?.count).toBe(9);
  });
});

// ─── Req 7.4: 10-value cap and ordering ──────────────────────────────────────

describe("value ordering and cap (Req 7.4)", () => {
  test("values are ordered by count descending", () => {
    const results = expectFacets(
      mergeFacets([
        contribution("jscholarship", [
          facet("subject", [
            { label: "Low", count: 1 },
            { label: "High", count: 100 },
            { label: "Medium", count: 50 },
          ]),
        ]),
      ]),
    );

    const subject = findFacet(results, "subject");
    expect(subject.values.map((value) => value.label)).toEqual(["High", "Medium", "Low"]);
  });

  test("count ties break to the display label in ascending Unicode order", () => {
    const results = expectFacets(
      mergeFacets([
        contribution("jscholarship", [
          facet("subject", [
            { label: "Zebra", count: 10 },
            { label: "Apple", count: 10 },
            { label: "Mango", count: 10 },
          ]),
        ]),
      ]),
    );

    const subject = findFacet(results, "subject");
    expect(subject.values.map((value) => value.label)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  test("each facet returns at most 10 values, keeping the highest counts", () => {
    const values = Array.from({ length: 15 }, (_, index) => ({
      label: `Subject ${String(index).padStart(2, "0")}`,
      count: index + 1,
    }));
    const results = expectFacets(
      mergeFacets([contribution("jscholarship", [facet("subject", values)])]),
    );

    const subject = findFacet(results, "subject");
    expect(subject.values).toHaveLength(MAX_FACET_VALUES);
    // The ten highest counts (15..6) survive; the smallest five are dropped.
    expect(subject.values[0]?.count).toBe(15);
    expect(subject.values[MAX_FACET_VALUES - 1]?.count).toBe(6);
    expect(subject.values.every((value) => value.count >= 6)).toBe(true);
  });
});

// ─── Req 7.5: synthetic repository facet ─────────────────────────────────────

describe("synthetic repository facet (Req 7.5)", () => {
  test("reports each participating repository's totalMatches, ordered by count desc", () => {
    const results = expectFacets(
      mergeFacets([
        contribution("jscholarship", [facet("subject", [{ label: "History", count: 1 }])], {
          totalMatches: 40,
        }),
        contribution("jhrdr", [facet("subject", [{ label: "History", count: 1 }])], {
          totalMatches: 120,
        }),
      ]),
    );

    const repositoryFacet = findFacet(results, "repository");
    expect(repositoryFacet.values).toEqual([
      {
        label: "jhrdr",
        count: 120,
        repositoryBreakdown: { jhrdr: 120 },
      },
      {
        label: "jscholarship",
        count: 40,
        repositoryBreakdown: { jscholarship: 40 },
      },
    ] satisfies FacetValue[]);
  });

  test("the repository facet leads the merged result", () => {
    const results = expectFacets(
      mergeFacets([
        contribution("jscholarship", [facet("subject", [{ label: "History", count: 1 }])], {
          totalMatches: 5,
        }),
      ]),
    );

    expect(results[0]?.facet).toBe("repository");
  });
});

// ─── Req 7.6: unsupported-facet path ─────────────────────────────────────────

describe("unsupported facet uses supporting adapters only (Req 7.6)", () => {
  test("a facet absent from a contribution's supported set is not an error", () => {
    const results = expectFacets(
      mergeFacets([
        // jscholarship supports and returns both facets.
        contribution(
          "jscholarship",
          [
            facet("subject", [{ label: "History", count: 7 }]),
            facet("year", [{ label: "2021", count: 3 }]),
          ],
          { totalMatches: 10 },
        ),
        // jhrdr supports only `subject`; it does not support `year` at all.
        contribution("jhrdr", [facet("subject", [{ label: "History", count: 2 }])], {
          totalMatches: 2,
          supported: ["subject"],
        }),
      ]),
    );

    // `subject` merges both repositories.
    const subject = findFacet(results, "subject");
    expect(subject.values).toHaveLength(1);
    expect(subject.values[0]?.count).toBe(9);
    expect(subject.values[0]?.repositoryBreakdown).toEqual({ jscholarship: 7, jhrdr: 2 });

    // `year` comes only from the supporting adapter; jhrdr is omitted, not errored.
    const year = findFacet(results, "year");
    expect(year.values).toHaveLength(1);
    expect(year.values[0]?.count).toBe(3);
    expect(year.values[0]?.repositoryBreakdown).toEqual({ jscholarship: 3 });
  });

  test("facet values returned for an unsupported facet are ignored", () => {
    const results = expectFacets(
      mergeFacets([
        contribution("jscholarship", [facet("subject", [{ label: "History", count: 4 }])], {
          totalMatches: 4,
        }),
        // jhrdr returns `subject` values but does not declare it supported.
        contribution("jhrdr", [facet("subject", [{ label: "History", count: 99 }])], {
          totalMatches: 50,
          supported: [],
        }),
      ]),
    );

    const subject = findFacet(results, "subject");
    // Only the supporting adapter's count is included; jhrdr's 99 is ignored.
    expect(subject.values[0]?.count).toBe(4);
    expect(subject.values[0]?.repositoryBreakdown).toEqual({ jscholarship: 4 });
  });
});

// ─── Req 7.7: all-fail path ──────────────────────────────────────────────────

describe("all-fail backend-unavailability (Req 7.7)", () => {
  test("no participating adapter returned facet data yields a FacetMergeError", () => {
    const result = mergeFacets([
      contribution("jscholarship", [], { totalMatches: 0 }),
      contribution("jhrdr", [], { totalMatches: 0 }),
    ]);

    expect(isFacetMergeError(result)).toBe(true);
    if (!isFacetMergeError(result)) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe("backend_unavailable");
    expect(result.error.message).not.toContain("http");
    expect(result.error.details?.repositories).toEqual(["jhrdr", "jscholarship"]);
  });

  test("an empty contribution list yields a backend-unavailability error", () => {
    const result = mergeFacets([]);

    expect(isFacetMergeError(result)).toBe(true);
    if (!isFacetMergeError(result)) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe("backend_unavailable");
  });

  test("a supported facet with only empty value lists counts as no data", () => {
    const result = mergeFacets([
      contribution("jscholarship", [facet("subject", [])]),
      contribution("jhrdr", [facet("subject", [])]),
    ]);

    expect(isFacetMergeError(result)).toBe(true);
    if (!isFacetMergeError(result)) {
      throw new Error("unreachable");
    }
    expect(result.error.code).toBe("backend_unavailable");
  });

  test("at least one adapter with data avoids the error path", () => {
    const result = mergeFacets([
      contribution("jscholarship", [facet("subject", [{ label: "History", count: 1 }])], {
        totalMatches: 1,
      }),
      contribution("jhrdr", [], { totalMatches: 0 }),
    ]);

    expect(isFacetMergeError(result)).toBe(false);
  });
});
