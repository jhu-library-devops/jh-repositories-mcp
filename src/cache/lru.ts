/**
 * Bounded In-Process LRU Cache with TTL
 *
 * Entry count is bounded (least-recently-used eviction) and every entry
 * carries a TTL. Only public normalized data is ever stored by callers; no
 * user identity, raw query text, token, or conversation content is cached.
 * The clock is injectable for deterministic tests.
 *
 * Requirements: 15.4
 */

export interface LruCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<V> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry<V>>();

  constructor(options: LruCacheOptions) {
    if (options.maxEntries < 1 || options.ttlMs < 1) {
      throw new Error("LruCache requires positive maxEntries and ttlMs");
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
