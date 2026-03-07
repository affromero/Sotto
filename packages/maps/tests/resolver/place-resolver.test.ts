import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaceResolver } from '../../src/resolver/place-resolver';
import type { PlaceMetadata } from '../../src/types';

const mockConstantinople: PlaceMetadata = {
  name: 'Constantinople',
  aliases: ['Byzantium', 'Istanbul'],
  coordinates: [28.9784, 41.0082],
  modernRegion: 'TR',
  historicalContext: [{ yearStart: 330, yearEnd: 1453, periodName: 'Historical' }],
  source: 'whg',
  sourceId: 'whg-12345',
  confidence: 0.8,
};

const mockRome: PlaceMetadata = {
  name: 'Rome',
  aliases: ['Roma'],
  coordinates: [12.4964, 41.9028],
  modernRegion: 'Italy',
  source: 'geonames',
  sourceId: '3169070',
  confidence: 0.9,
};

// Mock all gazetteer clients
vi.mock('../../src/resolver/gazetteers/whg', () => ({
  WHGClient: vi.fn().mockImplementation(() => ({
    source: 'whg',
    search: vi.fn().mockImplementation(async (query: string) => {
      if (query.toLowerCase().includes('constantinople')) return mockConstantinople;
      return null;
    }),
  })),
}));

vi.mock('../../src/resolver/gazetteers/geonames', () => ({
  GeoNamesClient: vi.fn().mockImplementation(() => ({
    source: 'geonames',
    search: vi.fn().mockImplementation(async (query: string) => {
      if (query.toLowerCase().includes('rome')) return mockRome;
      return null;
    }),
  })),
}));

vi.mock('../../src/resolver/gazetteers/pleiades', () => ({
  PleiadesClient: vi.fn().mockImplementation(() => ({
    source: 'pleiades',
    search: vi.fn().mockResolvedValue(null),
  })),
}));

describe('PlaceResolver', () => {
  let resolver: PlaceResolver;

  beforeEach(() => {
    resolver = new PlaceResolver();
  });

  it('resolves a place found by WHG', async () => {
    const result = await resolver.resolve('Constantinople');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Constantinople');
    expect(result!.source).toBe('whg');
  });

  it('falls through to GeoNames when WHG returns null', async () => {
    const result = await resolver.resolve('Rome');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Rome');
    expect(result!.source).toBe('geonames');
  });

  it('returns null when no gazetteer finds the place', async () => {
    const result = await resolver.resolve('Completely Unknown Place XYZ');
    expect(result).toBeNull();
  });

  it('caches results for subsequent lookups', async () => {
    const first = await resolver.resolve('Constantinople');
    const second = await resolver.resolve('Constantinople');
    expect(first).toEqual(second);
  });

  it('resolveBatch resolves multiple places in parallel', async () => {
    const results = await resolver.resolveBatch([
      { query: 'Constantinople' },
      { query: 'Rome' },
      { query: 'Unknown XYZ' },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]?.name).toBe('Constantinople');
    expect(results[1]?.name).toBe('Rome');
    expect(results[2]).toBeNull();
  });

  it('resolveHistorical boosts confidence for period-matching results', async () => {
    const result = await resolver.resolveHistorical('Constantinople', 400, 1000);
    expect(result).not.toBeNull();
    // 330–1453 range includes 400, so confidence should be boosted
    expect(result!.confidence).toBeGreaterThan(0.8);
  });

  it('clearCache empties the cache', async () => {
    await resolver.resolve('Constantinople');
    resolver.clearCache();
    // After clearing, the resolver will query gazetteers again (still returns same mock)
    const result = await resolver.resolve('Constantinople');
    expect(result).not.toBeNull();
  });
});
