import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeoNamesClient } from '../../../src/resolver/gazetteers/geonames';

const mockGeoNamesResponse = {
  totalResultsCount: 1,
  geonames: [
    {
      geonameId: 745044,
      name: 'Istanbul',
      toponymName: 'Istanbul',
      alternateNames: [
        { name: 'Constantinople', lang: 'en' },
        { name: 'Byzantium', lang: 'en' },
      ],
      lng: '28.9784',
      lat: '41.0082',
      countryName: 'Turkey',
      adminName1: 'Istanbul',
      fcl: 'P',
      fcode: 'PPLC',
      population: 14804116,
      bbox: { west: 28.6, east: 29.4, north: 41.3, south: 40.8 },
    },
  ],
};

describe('GeoNamesClient', () => {
  let client: GeoNamesClient;

  beforeEach(() => {
    client = new GeoNamesClient('test_user');
    vi.restoreAllMocks();
  });

  it('parses a successful GeoNames response into PlaceMetadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockGeoNamesResponse), { status: 200 }),
    );

    const result = await client.search('Istanbul');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Istanbul');
    expect(result!.coordinates).toEqual([28.9784, 41.0082]);
    expect(result!.aliases).toContain('Constantinople');
    expect(result!.source).toBe('geonames');
    expect(result!.sourceId).toBe('745044');
    expect(result!.confidence).toBe(0.9); // fcl === 'P' gives high confidence
    expect(result!.bbox).toEqual([28.6, 40.8, 29.4, 41.3]);
  });

  it('returns null when no username is configured', async () => {
    const noAuthClient = new GeoNamesClient('');
    const result = await noAuthClient.search('Istanbul');
    expect(result).toBeNull();
  });

  it('returns null for empty results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ totalResultsCount: 0, geonames: [] }), { status: 200 }),
    );

    const result = await client.search('NonexistentPlace');
    expect(result).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));

    const result = await client.search('Istanbul');
    expect(result).toBeNull();
  });

  it('assigns lower confidence for non-populated places', async () => {
    const nonPopulated = {
      ...mockGeoNamesResponse,
      geonames: [{ ...mockGeoNamesResponse.geonames[0], fcl: 'T' }],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(nonPopulated), { status: 200 }),
    );

    const result = await client.search('Mount Ararat');
    expect(result!.confidence).toBe(0.7);
  });

  it('builds modern region from admin and country', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockGeoNamesResponse), { status: 200 }),
    );

    const result = await client.search('Istanbul');
    expect(result!.modernRegion).toBe('Istanbul, Turkey');
  });
});
