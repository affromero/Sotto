import type { PlaceMetadata } from '../types';

interface CacheEntry {
  data: PlaceMetadata;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 86400; // 24 hours
const MAX_LRU_ENTRIES = 500;

export class PlaceCache {
  private readonly lru = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlSeconds: number = DEFAULT_TTL_SECONDS) {
    this.ttlMs = ttlSeconds * 1000;
  }

  private cacheKey(query: string, yearHint?: number): string {
    return yearHint ? `${query.toLowerCase()}:${yearHint}` : query.toLowerCase();
  }

  get(query: string, yearHint?: number): PlaceMetadata | null {
    const key = this.cacheKey(query, yearHint);
    const entry = this.lru.get(key);

    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.lru.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.lru.delete(key);
    this.lru.set(key, entry);
    return entry.data;
  }

  set(query: string, data: PlaceMetadata, yearHint?: number): void {
    const key = this.cacheKey(query, yearHint);

    // Evict oldest if at capacity
    if (this.lru.size >= MAX_LRU_ENTRIES) {
      const oldest = this.lru.keys().next().value;
      if (oldest !== undefined) {
        this.lru.delete(oldest);
      }
    }

    this.lru.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(query: string, yearHint?: number): boolean {
    return this.get(query, yearHint) !== null;
  }

  clear(): void {
    this.lru.clear();
  }

  get size(): number {
    return this.lru.size;
  }
}
