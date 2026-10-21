/**
 * Unit Tests: Repository Selector Resolution
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 *
 * Exercises `resolveSelector` over a structural `AdapterRegistry` test double:
 *   - `all`/omitted resolves to the eligible ids, sorted and deduplicated (Req 2.1).
 *   - a single id resolves to that id (Req 2.2).
 *   - an array resolves to its deduplicated, sorted set (Req 2.3).
 *   - an unknown id yields a `SelectorRejection` with code `unknown_repository` (Req 2.4).
 */

import { describe, expect, test } from "bun:test";
import {
  type AdapterRegistry,
  type RepositorySelector,
  isSelectorRejection,
  resolveSelector,
} from "../../src/federation/selector";
import type { RepositoryId } from "../../src/models/index";

/**
 * Build a structural `AdapterRegistry` double from the ids it knows about.
 *
 * `registered` are all ids present in the registry; `eligible` are the subset
 * whose startup schema validation succeeded (defaults to all registered ids).
 * Both collections are treated as sets so the double imposes no ordering of its
 * own — the selector is responsible for sorting and deduplication.
 */
function buildRegistryDouble(
  registered: readonly RepositoryId[],
  eligible: readonly RepositoryId[] = registered,
): AdapterRegistry {
  const registeredSet: ReadonlySet<RepositoryId> = new Set(registered);
  return {
    registeredIds(): readonly RepositoryId[] {
      return registered;
    },
    eligibleIds(): readonly RepositoryId[] {
      return eligible;
    },
    has(id: RepositoryId): boolean {
      return registeredSet.has(id);
    },
  };
}

const JSCHOLARSHIP: RepositoryId = "jscholarship";
const JHRDR: RepositoryId = "jhrdr";

describe("resolveSelector", () => {
  describe("all / omitted selector (Req 2.1)", () => {
    test("resolves 'all' to every eligible id, sorted", () => {
      const registry = buildRegistryDouble([JHRDR, JSCHOLARSHIP]);

      const result = resolveSelector("all", registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JHRDR, JSCHOLARSHIP]);
      }
    });

    test("resolves an omitted (undefined) selector to every eligible id", () => {
      const registry = buildRegistryDouble([JHRDR, JSCHOLARSHIP]);

      const result = resolveSelector(undefined, registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JHRDR, JSCHOLARSHIP]);
      }
    });

    test("excludes ineligible ids, returning only the eligible subset", () => {
      // Both ids are registered, but only jhrdr passed schema validation.
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR], [JHRDR]);

      const result = resolveSelector("all", registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JHRDR]);
      }
    });
  });

  describe("single id selector (Req 2.2)", () => {
    test("resolves a single id to just that id", () => {
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR]);

      const result = resolveSelector(JSCHOLARSHIP, registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JSCHOLARSHIP]);
      }
    });

    test("resolves a single id even when it is the only registered adapter", () => {
      const registry = buildRegistryDouble([JHRDR]);

      const result = resolveSelector(JHRDR, registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JHRDR]);
      }
    });
  });

  describe("array selector (Req 2.3)", () => {
    test("resolves an array to its sorted set", () => {
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR]);

      const result = resolveSelector([JSCHOLARSHIP, JHRDR], registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JHRDR, JSCHOLARSHIP]);
      }
    });

    test("deduplicates repeated ids in the array", () => {
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR]);

      const result = resolveSelector([JSCHOLARSHIP, JSCHOLARSHIP, JHRDR], registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JHRDR, JSCHOLARSHIP]);
      }
    });

    test("resolves a single-element array to that one id", () => {
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR]);

      const result = resolveSelector([JHRDR], registry);

      expect(isSelectorRejection(result)).toBe(false);
      if (!isSelectorRejection(result)) {
        expect(result.selected).toEqual([JHRDR]);
      }
    });
  });

  describe("unknown id rejection (Req 2.4)", () => {
    // Unknown ids are not part of the RepositoryId union; a client can still
    // send one on the wire, so the cast models that untrusted wire input.
    const UNKNOWN = "quartex" as RepositoryId;

    test("rejects a single unknown id with code 'unknown_repository'", () => {
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR]);

      const result = resolveSelector(UNKNOWN, registry);

      expect(isSelectorRejection(result)).toBe(true);
      if (isSelectorRejection(result)) {
        expect(result.code).toBe("unknown_repository");
        expect(result.unknownIds).toEqual([UNKNOWN]);
      }
    });

    test("rejects the whole request when an array mixes known and unknown ids", () => {
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR]);

      const result = resolveSelector([JSCHOLARSHIP, UNKNOWN], registry);

      expect(isSelectorRejection(result)).toBe(true);
      if (isSelectorRejection(result)) {
        expect(result.code).toBe("unknown_repository");
        expect(result.unknownIds).toEqual([UNKNOWN]);
      }
    });

    test("reports every unknown id, sorted and deduplicated", () => {
      const registry = buildRegistryDouble([JSCHOLARSHIP, JHRDR]);
      const other = "sheridan" as RepositoryId;
      const selector: RepositorySelector = [UNKNOWN, other, UNKNOWN];

      const result = resolveSelector(selector, registry);

      expect(isSelectorRejection(result)).toBe(true);
      if (isSelectorRejection(result)) {
        expect(result.code).toBe("unknown_repository");
        expect(result.unknownIds).toEqual([UNKNOWN, other]);
      }
    });
  });
});
