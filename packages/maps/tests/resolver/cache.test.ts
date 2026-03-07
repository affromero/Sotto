import { describe, it, expect, beforeEach } from 'vitest';
import { PlaceCache } from '../../src/resolver/cache';
import type { PlaceMetadata } from '../../src/types';

const mockPlace: PlaceMetadata = {
  name: 'Constantinople',
  aliases: ['Istanbul', 'Byzantium'],
  coordinates: [28.9784, 41.0082],
  modernRegion: 'Turkey',
  source: 'whg',
  sourceId: '12345',
  confidence: 0.8,
};

describe('PlaceCache', () => {
  let cache: PlaceCache;

  beforeEach(() => {
    cache = new PlaceCache(3600); // 1 hour TTL
  });

  it('returns null for cache miss', () => {
    expect(cache.get('Constantinople')).toBeNull();
  });

  it('stores and retrieves a place', () => {
    cache.set('Constantinople', mockPlace);
    const result = cache.get('Constantinople');
    expect(result).toEqual(mockPlace);
  });

  it('is case-insensitive', () => {
    cache.set('Constantinople', mockPlace);
    expect(cache.get('constantinople')).toEqual(mockPlace);
    expect(cache.get('CONSTANTINOPLE')).toEqual(mockPlace);
  });

  it('includes yearHint in cache key', () => {
    const ancientPlace = { ...mockPlace, name: 'Byzantium' };
    cache.set('Constantinople', mockPlace);
    cache.set('Constantinople', ancientPlace, 330);

    expect(cache.get('Constantinople')).toEqual(mockPlace);
    expect(cache.get('Constantinople', 330)).toEqual(ancientPlace);
  });

  it('expires entries after TTL', () => {
    const shortCache = new PlaceCache(0); // 0 seconds TTL
    shortCache.set('Constantinople', mockPlace);
    // Entry should be expired immediately
    expect(shortCache.get('Constantinople')).toBeNull();
  });

  it('evicts oldest entry when at capacity', () => {
    const smallCache = new PlaceCache(3600);
    // Fill cache beyond LRU limit by using internal knowledge of MAX_LRU_ENTRIES = 500
    for (let i = 0; i < 501; i++) {
      smallCache.set(`place-${i}`, { ...mockPlace, name: `Place ${i}` });
    }

    // First entry should be evicted
    expect(smallCache.get('place-0')).toBeNull();
    // Last entry should still exist
    expect(smallCache.get('place-500')).not.toBeNull();
  });

  it('has() returns true for cached entries', () => {
    cache.set('Constantinople', mockPlace);
    expect(cache.has('Constantinople')).toBe(true);
    expect(cache.has('Rome')).toBe(false);
  });

  it('clear() removes all entries', () => {
    cache.set('Constantinople', mockPlace);
    cache.set('Rome', { ...mockPlace, name: 'Rome' });
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('Constantinople')).toBeNull();
  });

  it('refreshes LRU order on access', () => {
    const smallCache = new PlaceCache(3600);
    // Add entries up to just under limit
    for (let i = 0; i < 500; i++) {
      smallCache.set(`place-${i}`, { ...mockPlace, name: `Place ${i}` });
    }

    // Access place-0 to refresh its position
    smallCache.get('place-0');

    // Add one more to trigger eviction
    smallCache.set('place-500', { ...mockPlace, name: 'Place 500' });

    // place-0 should survive (was refreshed), place-1 should be evicted (oldest)
    expect(smallCache.get('place-0')).not.toBeNull();
    expect(smallCache.get('place-1')).toBeNull();
  });
});
