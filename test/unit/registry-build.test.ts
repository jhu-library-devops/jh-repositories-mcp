/**
 * Unit Tests: Registry Fatal-Error Cases and Schema Exclusion
 *
 * **Validates: Requirements 1.2, 1.4, 1.6, 3.8, 8.7, 10.1, 10.2**
 *
 * Exercises `buildRegistry` over fake `RepositoryAdapter` test doubles, covering
 * every `RegistryFatalError` code and the non-fatal schema-exclusion path. The
 * ordered checks inside `buildRegistry` run as weight → max-count → duplicate →
 * schema → all-fail → cursor-size, so each case is constructed to isolate the
 * single condition it targets without tripping an earlier check:
 *
 *   - `weight_out_of_range` — an explicit weight outside 0.01–100.0 (Req 1.6, 10.2).
 *   - `adapter_count_exceeds_max` — more registrations than `maxAdapters` (Req 10.1).
 *   - `duplicate_repository_id` — two registrations sharing a `RepositoryId` (Req 1.2).
 *   - `no_adapter_registered` — an empty registration set (Req 1.2).
 *   - `all_adapters_schema_invalid` — every adapter fails schema validation (Req 1.4, 8.7).
 *   - `cursor_size_bound_exceeded` — a registered id set large enough to breach
 *     the encoded cursor-size limit (Req 3.8).
 *
 * The schema-exclusion path asserts that one schema-failing adapter is excluded
 * from `eligibleIds()` while remaining present in `registeredIds()`, and the
 * other adapter still becomes ready with no fatal error (Req 1.4, 8.7).
 */

import { describe, expect, test } from "bun:test";
import {
  type AdapterRegistration,
  type FederationLimits,
  type RepositoryAdapter,
  buildRegistry,
} from "../../src/adapters/index";
import type {
  ItemDetail,
  RepositoryFacets,
  RepositoryId,
  RepositoryPage,
  SchemaValidationResult,
} from "../../src/models/index";

// ─── Fake Adapter Test Double ────────────────────────────────────────────────

/**
 * Build a fake `RepositoryAdapter` that declares contract version 2 and reports
 * the given schema validity.
 *
 * Only `id`, `contractVersion`, and `validateSchema` participate in the registry
 * build path, so the remaining contract methods reject if ever called —
 * `buildRegistry` must never dispatch `search`/`get`/`facets`/`related` while
 * constructing the registry. `probePublic` is present to satisfy the v2 contract.
 */
function fakeAdapter(id: RepositoryId, schemaValid: boolean): RepositoryAdapter {
  const notCalled = (method: string): Promise<never> =>
    Promise.reject(new Error(`fake adapter ${id}: ${method} must not be called during build`));

  const schemaResult: SchemaValidationResult = {
    repository: id,
    valid: schemaValid,
    missingRequired: schemaValid ? [] : ["title"],
    missingOptional: [],
    disabledFeatures: [],
  };

  return {
    id,
    contractVersion: 2,
    validateSchema(): Promise<SchemaValidationResult> {
      return Promise.resolve(schemaResult);
    },
    search(): Promise<RepositoryPage> {
      return notCalled("search") as Promise<RepositoryPage>;
    },
    get(): Promise<ItemDetail | null> {
      return notCalled("get") as Promise<ItemDetail | null>;
    },
    facets(): Promise<RepositoryFacets> {
      return notCalled("facets") as Promise<RepositoryFacets>;
    },
    related(): Promise<RepositoryPage> {
      return notCalled("related") as Promise<RepositoryPage>;
    },
    probePublic(): Promise<boolean> {
      return notCalled("probePublic") as Promise<boolean>;
    },
  };
}

/** A registration for a schema-valid adapter with the given id and optional weight. */
function registration(id: RepositoryId, weight?: number): AdapterRegistration {
  return weight === undefined
    ? { adapter: fakeAdapter(id, true) }
    : { adapter: fakeAdapter(id, true), weight };
}

/** Federation limits with a generous adapter ceiling, overridable per case. */
function limits(maxAdapters = 16): Pick<FederationLimits, "maxAdapters"> {
  return { maxAdapters };
}

/**
 * Synthesize `count` distinct `RepositoryId`s. The real union has only two
 * members, but a client/config can present more ids on the wire, so the cast
 * models that untrusted input for the count- and cursor-size cases.
 */
function syntheticIds(count: number, prefix = "repo"): RepositoryId[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}` as RepositoryId);
}

const JSCHOLARSHIP: RepositoryId = "jscholarship";
const JHRDR: RepositoryId = "jhrdr";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildRegistry fatal-error cases", () => {
  describe("weight_out_of_range (Req 1.6, 10.2)", () => {
    test("rejects a weight below the 0.01 minimum", async () => {
      const result = await buildRegistry([registration(JSCHOLARSHIP, 0)], limits());

      expect(result.fatalError?.code).toBe("weight_out_of_range");
      expect(result.registry.registeredIds()).toEqual([]);
    });

    test("rejects a weight above the 100.0 maximum", async () => {
      const result = await buildRegistry([registration(JSCHOLARSHIP, 100.01)], limits());

      expect(result.fatalError?.code).toBe("weight_out_of_range");
    });

    test("rejects a non-finite weight", async () => {
      const result = await buildRegistry(
        [registration(JSCHOLARSHIP, Number.POSITIVE_INFINITY)],
        limits(),
      );

      expect(result.fatalError?.code).toBe("weight_out_of_range");
    });

    test("accepts the inclusive boundary weights 0.01 and 100.0", async () => {
      const result = await buildRegistry(
        [registration(JSCHOLARSHIP, 0.01), registration(JHRDR, 100.0)],
        limits(),
      );

      expect(result.fatalError).toBeNull();
      expect(result.registry.weightOf(JSCHOLARSHIP)).toBe(0.01);
      expect(result.registry.weightOf(JHRDR)).toBe(100.0);
    });
  });

  describe("adapter_count_exceeds_max (Req 10.1)", () => {
    test("rejects when the registered count exceeds maxAdapters", async () => {
      const [first, second, third] = syntheticIds(3);
      const registrations = [registration(first), registration(second), registration(third)];

      const result = await buildRegistry(registrations, limits(2));

      expect(result.fatalError?.code).toBe("adapter_count_exceeds_max");
      expect(result.registry.registeredIds()).toEqual([]);
    });

    test("accepts exactly maxAdapters registrations", async () => {
      const [first, second] = syntheticIds(2);

      const result = await buildRegistry([registration(first), registration(second)], limits(2));

      expect(result.fatalError).toBeNull();
      expect(result.registry.registeredIds()).toHaveLength(2);
    });
  });

  describe("duplicate_repository_id (Req 1.2)", () => {
    test("rejects two registrations that share a repository id", async () => {
      const result = await buildRegistry(
        [registration(JSCHOLARSHIP), registration(JSCHOLARSHIP)],
        limits(),
      );

      expect(result.fatalError?.code).toBe("duplicate_repository_id");
      expect(result.registry.registeredIds()).toEqual([]);
    });
  });

  describe("no_adapter_registered (Req 1.2)", () => {
    test("rejects an empty registration set", async () => {
      const result = await buildRegistry([], limits());

      expect(result.fatalError?.code).toBe("no_adapter_registered");
      expect(result.registry.registeredIds()).toEqual([]);
    });
  });

  describe("all_adapters_schema_invalid (Req 1.4, 8.7)", () => {
    test("rejects when every registered adapter fails schema validation", async () => {
      const result = await buildRegistry(
        [{ adapter: fakeAdapter(JSCHOLARSHIP, false) }, { adapter: fakeAdapter(JHRDR, false) }],
        limits(),
      );

      expect(result.fatalError?.code).toBe("all_adapters_schema_invalid");
      expect(result.registry.registeredIds()).toEqual([]);
    });
  });

  describe("cursor_size_bound_exceeded (Req 3.8)", () => {
    test("rejects a registered id set that would breach the encoded cursor-size limit", async () => {
      // Long ids plus a high count drive the worst-case cursor past 2048 bytes
      // while every earlier check passes: valid default weights, count within
      // maxAdapters, no duplicates, all schema-valid.
      const longPrefix = "repository-with-a-deliberately-long-namespaced-identifier";
      const ids = syntheticIds(48, longPrefix);
      const registrations = ids.map((id) => registration(id));

      const result = await buildRegistry(registrations, limits(ids.length));

      expect(result.fatalError?.code).toBe("cursor_size_bound_exceeded");
      expect(result.registry.registeredIds()).toEqual([]);
    });
  });
});

describe("buildRegistry schema-exclusion-but-others-ready path (Req 1.4, 8.7)", () => {
  test("excludes a schema-failing adapter while the valid one becomes ready", async () => {
    const result = await buildRegistry(
      [{ adapter: fakeAdapter(JSCHOLARSHIP, false) }, { adapter: fakeAdapter(JHRDR, true) }],
      limits(),
    );

    // No fatal error: at least one adapter is schema-eligible.
    expect(result.fatalError).toBeNull();

    // The failing adapter is still registered, so it appears in registeredIds().
    expect(result.registry.registeredIds()).toEqual([JHRDR, JSCHOLARSHIP]);
    expect(result.registry.has(JSCHOLARSHIP)).toBe(true);

    // But it is excluded from dispatch eligibility.
    expect(result.registry.eligibleIds()).toEqual([JHRDR]);

    const failing = result.registry.get(JSCHOLARSHIP);
    expect(failing?.eligible).toBe(false);
    expect(failing?.ineligibleReason).toBe("schema_validation_failed");

    const ready = result.registry.get(JHRDR);
    expect(ready?.eligible).toBe(true);
    expect(ready?.ineligibleReason).toBeNull();
  });
});
