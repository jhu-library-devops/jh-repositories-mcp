/**
 * Caching Adapter Decorator
 *
 * Wraps a RepositoryAdapter with the two bounded in-process caches the spec
 * allows: search responses (short TTL) and canonical records (longer TTL).
 * Before a cached canonical record is emitted, the platform-specific
 * revalidation probe runs — a record that is no longer public is evicted and
 * reported not found, and probe backend faults propagate so the cache fails
 * closed rather than serving possibly-withdrawn data.
 *
 * The search cache needs no revalidation: its entries were validated during
 * canonicalization and its TTL is at or below Solr re-index lag.
 *
 * Cache entries hold public normalized data only — never user identity,
 * tokens, or conversation content.
 *
 * Requirements: 15.4, 15.9
 */

import { LruCache } from "../cache/lru";
import type {
  ItemDetail,
  RelatedRequest,
  RepositoryFacetRequest,
  RepositoryFacets,
  RepositoryId,
  RepositoryIdentifier,
  RepositoryPage,
  RepositoryRecord,
  RepositorySearchRequest,
  SchemaValidationResult,
} from "../models/index";
import type { GetOptions, RepositoryAdapter } from "./index";

export interface CachingOptions {
  searchTtlMs: number;
  canonicalRecordTtlMs: number;
  maxEntries: number;
  now?: () => number;
}

/** JSON with sorted keys so equivalent requests share one cache entry. */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableKey).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`);
  return `{${entries.join(",")}}`;
}

export function withCaching(
  adapter: RepositoryAdapter,
  options: CachingOptions,
): RepositoryAdapter {
  const searchCache = new LruCache<RepositoryPage>({
    maxEntries: options.maxEntries,
    ttlMs: options.searchTtlMs,
    now: options.now,
  });
  const recordCache = new LruCache<ItemDetail>({
    maxEntries: options.maxEntries,
    ttlMs: options.canonicalRecordTtlMs,
    now: options.now,
  });

  const cached: RepositoryAdapter = {
    id: adapter.id,

    validateSchema(): Promise<SchemaValidationResult> {
      return adapter.validateSchema();
    },

    async search(request: RepositorySearchRequest): Promise<RepositoryPage> {
      const key = stableKey(request);
      const hit = searchCache.get(key);
      if (hit !== undefined) {
        return hit;
      }
      const page = await adapter.search(request);
      searchCache.set(key, page);
      return page;
    },

    async get(identifier: RepositoryIdentifier, options?: GetOptions): Promise<ItemDetail | null> {
      const key = stableKey({ repository: identifier.repository, value: identifier.value });
      const hit = recordCache.get(key);
      if (hit !== undefined) {
        // Revalidate on emit (Requirement 15.9). A missing probe means the
        // cached record cannot be verified — treat as a miss, never serve.
        if (adapter.probePublic === undefined) {
          recordCache.delete(key);
        } else {
          const stillPublic = await adapter.probePublic(hit);
          if (stillPublic) {
            return hit;
          }
          recordCache.delete(key);
          return null;
        }
      }
      const item = await adapter.get(identifier, options);
      // A degraded record is served once but never cached, so the next call
      // retries the file listing instead of repeating the gap for a full TTL.
      if (item !== null && item.filesStatus === "complete") {
        recordCache.set(key, item);
      }
      return item;
    },

    facets(request: RepositoryFacetRequest): Promise<RepositoryFacets> {
      return adapter.facets(request);
    },

    related(source: ItemDetail, request: RelatedRequest): Promise<RepositoryPage> {
      return adapter.related(source, request);
    },
  };

  if (adapter.probePublic) {
    cached.probePublic = (record: RepositoryRecord) => {
      if (adapter.probePublic === undefined) {
        return Promise.resolve(false);
      }
      return adapter.probePublic(record);
    };
  }

  return cached;
}
