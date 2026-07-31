/**
 * Unit Tests: Resilience, Caching, and Concurrency
 *
 * **Validates: Requirements 14.6, 15.1-15.4, 15.9**
 *
 * Retry exhaustion and jitter bounds, LRU expiry and eviction, search-cache
 * hits, revalidation-probe eviction on withdrawal/deaccession, fail-closed
 * probe faults, and tool-concurrency saturation.
 */

import { describe, expect, test } from "bun:test";
import { withCaching } from "../../src/adapters/caching";
import type { RepositoryAdapter } from "../../src/adapters/index";
import { MAX_ATTEMPTS, backoffDelayMs, withRetry } from "../../src/adapters/retry";
import { LruCache } from "../../src/cache/lru";
import { createItemDetail, createRepositoryRecord } from "../../src/models/index";
import type { ItemDetail, RepositoryPage } from "../../src/models/index";
import { createSemaphore } from "../../src/security/index";

// ─── Retry (Requirement 15.2) ────────────────────────────────────────────────

describe("withRetry", () => {
  test("makes at most two total attempts for transient failures", async () => {
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.reject(new Error("ECONNRESET"));
    };
    await expect(
      withRetry(failing, { isTransient: () => true, sleep: async () => {} }),
    ).rejects.toThrow("ECONNRESET");
    expect(calls).toBe(MAX_ATTEMPTS);
  });

  test("never retries non-transient failures", async () => {
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.reject(new Error("HTTP 404"));
    };
    await expect(
      withRetry(failing, { isTransient: () => false, sleep: async () => {} }),
    ).rejects.toThrow("HTTP 404");
    expect(calls).toBe(1);
  });

  test("succeeds on the retry after one transient failure", async () => {
    let calls = 0;
    const flaky = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("timeout")) : Promise.resolve("ok");
    };
    const delays: number[] = [];
    const result = await withRetry(flaky, {
      isTransient: () => true,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(result).toBe("ok");
    expect(delays).toHaveLength(1);
  });

  test("backoff delays are jittered within the exponential ceiling", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ceiling = 200 * 2 ** attempt;
      expect(backoffDelayMs(attempt, () => 0)).toBeGreaterThanOrEqual(1);
      expect(backoffDelayMs(attempt, () => 0.999999)).toBeLessThanOrEqual(ceiling);
      const a = backoffDelayMs(attempt, () => 0.25);
      const b = backoffDelayMs(attempt, () => 0.75);
      expect(a).not.toBe(b);
    }
  });
});

// ─── LRU cache (Requirement 15.4) ────────────────────────────────────────────

describe("LruCache", () => {
  test("expires entries after the TTL", () => {
    let clock = 0;
    const cache = new LruCache<string>({ maxEntries: 10, ttlMs: 100, now: () => clock });
    cache.set("a", "value");
    clock = 99;
    expect(cache.get("a")).toBe("value");
    clock = 100;
    expect(cache.get("a")).toBeUndefined();
  });

  test("evicts the least-recently-used entry at capacity", () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 10_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // refresh a
    cache.set("c", 3); // evicts b
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });
});

// ─── Caching adapter (Requirements 15.4, 15.9) ──────────────────────────────

function itemDetail(): ItemDetail {
  const record = createRepositoryRecord({
    platformId: "11111111-1111-1111-1111-111111111111",
    repository: "jscholarship",
    kind: "repository_item",
    title: "Cached record",
    landingPageUrl: "https://example.jhu.edu/x",
    provenance: {
      platform: "dspace",
      platformRecordId: "11111111-1111-1111-1111-111111111111",
      canonicalApi: "dspace_rest",
      retrievedAt: "2026-07-31T00:00:00.000Z",
    },
  });
  return createItemDetail(record, []);
}

interface InstrumentedAdapter extends RepositoryAdapter {
  searchCalls: number;
  getCalls: number;
  probeCalls: number;
  probeResult: boolean | Error;
}

function instrumentedAdapter(): InstrumentedAdapter {
  const item = itemDetail();
  const page: RepositoryPage = {
    repository: "jscholarship",
    results: [],
    nextOffset: null,
    totalCandidates: 0,
    validationOmissions: 0,
    warnings: [],
  };
  const adapter: InstrumentedAdapter = {
    id: "jscholarship",
    searchCalls: 0,
    getCalls: 0,
    probeCalls: 0,
    probeResult: true,
    async validateSchema() {
      return {
        repository: "jscholarship",
        valid: true,
        missingRequired: [],
        missingOptional: [],
        disabledFeatures: [],
      };
    },
    async search() {
      adapter.searchCalls += 1;
      return page;
    },
    async get() {
      adapter.getCalls += 1;
      return item;
    },
    async probePublic() {
      adapter.probeCalls += 1;
      if (adapter.probeResult instanceof Error) {
        throw adapter.probeResult;
      }
      return adapter.probeResult;
    },
    async facets() {
      return { repository: "jscholarship", facets: [], warnings: [] };
    },
    async related() {
      return page;
    },
  };
  return adapter;
}

const IDENTIFIER = {
  repository: "jscholarship" as const,
  type: "uuid" as const,
  value: "11111111-1111-1111-1111-111111111111",
};

describe("withCaching", () => {
  test("search responses are cached within the TTL and expire after it", async () => {
    let clock = 0;
    const inner = instrumentedAdapter();
    const cached = withCaching(inner, {
      searchTtlMs: 60_000,
      canonicalRecordTtlMs: 300_000,
      maxEntries: 50,
      now: () => clock,
    });
    const request = { query: "wetlands", limit: 10, offset: 0 };
    await cached.search(request);
    await cached.search(request);
    expect(inner.searchCalls).toBe(1);
    clock = 60_001;
    await cached.search(request);
    expect(inner.searchCalls).toBe(2);
  });

  test("cached records are revalidated on emit and served while still public", async () => {
    const inner = instrumentedAdapter();
    const cached = withCaching(inner, {
      searchTtlMs: 60_000,
      canonicalRecordTtlMs: 300_000,
      maxEntries: 50,
    });
    await cached.get(IDENTIFIER);
    const second = await cached.get(IDENTIFIER);
    expect(second?.title).toBe("Cached record");
    expect(inner.getCalls).toBe(1);
    expect(inner.probeCalls).toBe(1);
  });

  test("withdrawal evicts the cached record and returns not-found", async () => {
    const inner = instrumentedAdapter();
    const cached = withCaching(inner, {
      searchTtlMs: 60_000,
      canonicalRecordTtlMs: 300_000,
      maxEntries: 50,
    });
    await cached.get(IDENTIFIER);
    inner.probeResult = false; // withdrawn after caching
    expect(await cached.get(IDENTIFIER)).toBeNull();
    // Next call re-fetches from the canonical API (entry was evicted).
    inner.probeResult = true;
    await cached.get(IDENTIFIER);
    expect(inner.getCalls).toBe(2);
  });

  test("probe backend faults propagate instead of serving possibly-stale data", async () => {
    const inner = instrumentedAdapter();
    const cached = withCaching(inner, {
      searchTtlMs: 60_000,
      canonicalRecordTtlMs: 300_000,
      maxEntries: 50,
    });
    await cached.get(IDENTIFIER);
    inner.probeResult = new Error("probe backend down");
    await expect(cached.get(IDENTIFIER)).rejects.toThrow("probe backend down");
  });
});

// ─── Concurrency semaphore (Requirement 14.6) ───────────────────────────────

describe("createSemaphore", () => {
  test("rejects immediately at capacity and recovers on release", () => {
    const semaphore = createSemaphore(2);
    expect(semaphore.tryAcquire()).toBe(true);
    expect(semaphore.tryAcquire()).toBe(true);
    expect(semaphore.tryAcquire()).toBe(false);
    semaphore.release();
    expect(semaphore.tryAcquire()).toBe(true);
    expect(semaphore.active).toBe(2);
  });
});
