/**
 * Unit Tests: N-Way Partial-Result Assembly
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.7, 6.8**
 *
 * Exercises `assemblePartial` over hand-built dispatch outcomes and a minimal
 * `MergeResult`:
 *   - partial success (≥1 success + ≥1 failure): succeeded results are kept,
 *     `isError` is false, `repositories.{requested,succeeded,failed}` are
 *     populated, and each errored repo yields exactly one `backend_unavailable`
 *     warning with no endpoints or stack traces (Req 6.1, 6.2, 6.3).
 *   - all-fail: `isError` is true, results empty, cursor null (Req 6.4).
 *   - `timeout` outcome emits a `deadline_exceeded` warning naming the repo (Req 6.7).
 *   - `validation_attrition` on a success keeps that page's results and emits a
 *     `validation_attrition` warning (Req 6.8).
 *   - `repositories.{requested,succeeded,failed}` are sorted and correct (Req 6.3).
 */

import { describe, expect, test } from "bun:test";
import type { MergeResult } from "../../src/federation/merge";
import {
  type AdapterResult,
  type AssemblePartialOptions,
  assemblePartial,
} from "../../src/federation/partial-assembly";
import { createRepositoryRecord } from "../../src/models/index";
import type {
  Provenance,
  RepositoryId,
  RepositoryPage,
  RepositoryRecord,
} from "../../src/models/index";

const JSCHOLARSHIP: RepositoryId = "jscholarship";
const JHRDR: RepositoryId = "jhrdr";

/** A minimal DSpace provenance stamp for synthetic records. */
function provenanceFor(repository: RepositoryId): Provenance {
  const platform = repository === "jhrdr" ? "dataverse" : "dspace";
  return {
    platform,
    platformRecordId: "rec-1",
    canonicalApi: platform === "dataverse" ? "dataverse_native_api" : "dspace_rest",
    retrievedAt: "2024-01-01T00:00:00.000Z",
  };
}

/** Build a single synthetic result record attributed to `repository`. */
function recordFor(
  repository: RepositoryId,
  platformId: string,
  sourceRank: number,
): RepositoryRecord {
  return createRepositoryRecord({
    platformId,
    repository,
    kind: "repository_item",
    title: `Record ${platformId}`,
    landingPageUrl: `https://example.org/${platformId}`,
    provenance: provenanceFor(repository),
    sourceRank,
  });
}

/** A successful adapter outcome carrying a one-record page. */
function successResult(repository: RepositoryId, record: RepositoryRecord): AdapterResult {
  const page: RepositoryPage = {
    repository,
    results: [record],
    nextOffset: 1,
    totalCandidates: 1,
    validationOmissions: 0,
    warnings: [],
  };
  return { repository, outcome: "success", page, failureCode: null };
}

/** An errored adapter outcome with a `backend_unavailable` failure code. */
function errorResult(repository: RepositoryId): AdapterResult {
  return { repository, outcome: "error", page: null, failureCode: "backend_unavailable" };
}

/** A timed-out adapter outcome mapping to `deadline_exceeded`. */
function timeoutResult(repository: RepositoryId): AdapterResult {
  return { repository, outcome: "timeout", page: null, failureCode: "deadline_exceeded" };
}

/**
 * A success outcome that still carries a `validation_attrition` failure code:
 * the adapter returned the candidates it validated before its Canonical API
 * dropped (Req 6.8).
 */
function attritionResult(repository: RepositoryId, record: RepositoryRecord): AdapterResult {
  const page: RepositoryPage = {
    repository,
    results: [record],
    nextOffset: 1,
    totalCandidates: 2,
    validationOmissions: 1,
    warnings: [],
  };
  return { repository, outcome: "success", page, failureCode: "validation_attrition" };
}

/** A minimal `MergeResult` carrying the given merged records and no warnings. */
function mergeResultFor(records: readonly RepositoryRecord[]): MergeResult {
  return { results: records, nextCursor: null, warnings: [] };
}

/** Assemble with sensible defaults, overridable per test. */
function assemble(overrides: Partial<AssemblePartialOptions>): ReturnType<typeof assemblePartial> {
  const options: AssemblePartialOptions = {
    requested: [],
    results: [],
    mergeResult: mergeResultFor([]),
    encodedCursor: null,
    ...overrides,
  };
  return assemblePartial(options);
}

describe("assemblePartial", () => {
  describe("partial success (Req 6.1, 6.2, 6.3)", () => {
    test("keeps succeeded results, reports isError false, and populates repository metadata", () => {
      const jsRecord = recordFor(JSCHOLARSHIP, "a", 1);

      const { response, isError } = assemble({
        requested: [JSCHOLARSHIP, JHRDR],
        results: [successResult(JSCHOLARSHIP, jsRecord), errorResult(JHRDR)],
        mergeResult: mergeResultFor([jsRecord]),
        encodedCursor: "cursor-token",
      });

      expect(isError).toBe(false);
      expect(response.results).toEqual([jsRecord]);
      expect(response.count).toBe(1);
      expect(response.cursor).toBe("cursor-token");
      expect(response.repositories.requested).toEqual([JHRDR, JSCHOLARSHIP]);
      expect(response.repositories.succeeded).toEqual([JSCHOLARSHIP]);
      expect(response.repositories.failed).toEqual([JHRDR]);
    });

    test("emits exactly one backend_unavailable warning per errored repo, with no endpoints or stack traces", () => {
      const jsRecord = recordFor(JSCHOLARSHIP, "a", 1);

      const { response } = assemble({
        requested: [JSCHOLARSHIP, JHRDR],
        results: [successResult(JSCHOLARSHIP, jsRecord), errorResult(JHRDR)],
        mergeResult: mergeResultFor([jsRecord]),
        encodedCursor: "cursor-token",
      });

      const backendWarnings = response.warnings.filter(
        (warning) => warning.code === "backend_unavailable",
      );
      expect(backendWarnings).toHaveLength(1);

      const warning = backendWarnings[0];
      expect(warning?.repository).toBe(JHRDR);
      expect(warning?.message).not.toMatch(/https?:\/\//);
      expect(warning?.message).not.toMatch(/\bat\s.+:\d+/); // stack-frame shape
      expect(warning?.message).not.toContain("Error:");
    });
  });

  describe("all-fail structured error (Req 6.4)", () => {
    test("reports isError true with empty results and a null cursor when every adapter fails", () => {
      const { response, isError } = assemble({
        requested: [JSCHOLARSHIP, JHRDR],
        results: [errorResult(JSCHOLARSHIP), errorResult(JHRDR)],
        // Even if a stale merge somehow carried records, assembly must suppress them.
        mergeResult: mergeResultFor([recordFor(JSCHOLARSHIP, "stale", 1)]),
        encodedCursor: "would-be-cursor",
      });

      expect(isError).toBe(true);
      expect(response.results).toEqual([]);
      expect(response.count).toBe(0);
      expect(response.cursor).toBeNull();
      expect(response.repositories.succeeded).toEqual([]);
      expect(response.repositories.failed).toEqual([JHRDR, JSCHOLARSHIP]);
    });

    test("reports isError true when every adapter times out", () => {
      const { response, isError } = assemble({
        requested: [JSCHOLARSHIP, JHRDR],
        results: [timeoutResult(JSCHOLARSHIP), timeoutResult(JHRDR)],
      });

      expect(isError).toBe(true);
      expect(response.results).toEqual([]);
      expect(response.cursor).toBeNull();
    });
  });

  describe("timeout → deadline_exceeded warning (Req 6.7)", () => {
    test("maps a timeout outcome to a deadline_exceeded warning naming the repo when results exist", () => {
      const jsRecord = recordFor(JSCHOLARSHIP, "a", 1);

      const { response, isError } = assemble({
        requested: [JSCHOLARSHIP, JHRDR],
        results: [successResult(JSCHOLARSHIP, jsRecord), timeoutResult(JHRDR)],
        mergeResult: mergeResultFor([jsRecord]),
        encodedCursor: "cursor-token",
      });

      expect(isError).toBe(false);
      const deadlineWarnings = response.warnings.filter(
        (warning) => warning.code === "deadline_exceeded",
      );
      expect(deadlineWarnings).toHaveLength(1);
      expect(deadlineWarnings[0]?.repository).toBe(JHRDR);
      expect(response.repositories.failed).toEqual([JHRDR]);
      expect(response.repositories.succeeded).toEqual([JSCHOLARSHIP]);
    });
  });

  describe("validation_attrition on a success (Req 6.8)", () => {
    test("keeps the attrition page's results and emits a validation_attrition warning", () => {
      const jsRecord = recordFor(JSCHOLARSHIP, "a", 1);
      const jhrdrRecord = recordFor(JHRDR, "b", 1);

      const { response, isError } = assemble({
        requested: [JSCHOLARSHIP, JHRDR],
        results: [successResult(JSCHOLARSHIP, jsRecord), attritionResult(JHRDR, jhrdrRecord)],
        mergeResult: mergeResultFor([jsRecord, jhrdrRecord]),
        encodedCursor: "cursor-token",
      });

      expect(isError).toBe(false);
      // The attrition repository still counts as succeeded (it contributed results).
      expect(response.repositories.succeeded).toEqual([JHRDR, JSCHOLARSHIP]);
      expect(response.repositories.failed).toEqual([]);
      // Its validated results are retained in the merged page.
      expect(response.results).toContainEqual(jhrdrRecord);

      const attritionWarnings = response.warnings.filter(
        (warning) => warning.code === "validation_attrition",
      );
      expect(attritionWarnings).toHaveLength(1);
      expect(attritionWarnings[0]?.repository).toBe(JHRDR);
    });
  });

  describe("repository metadata sorting (Req 6.3)", () => {
    test("sorts and deduplicates requested, succeeded, and failed id lists", () => {
      const jsRecord = recordFor(JSCHOLARSHIP, "a", 1);

      const { response } = assemble({
        // Supplied out of lexicographic order and with a duplicate.
        requested: [JSCHOLARSHIP, JHRDR, JSCHOLARSHIP],
        results: [successResult(JSCHOLARSHIP, jsRecord), errorResult(JHRDR)],
        mergeResult: mergeResultFor([jsRecord]),
        encodedCursor: "cursor-token",
      });

      expect(response.repositories.requested).toEqual([JHRDR, JSCHOLARSHIP]);
      expect(response.repositories.succeeded).toEqual([JSCHOLARSHIP]);
      expect(response.repositories.failed).toEqual([JHRDR]);
    });
  });
});
