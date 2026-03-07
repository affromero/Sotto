import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WHGClient } from '../../../src/resolver/gazetteers/whg';

const mockWHGResponse = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        pid: 'whg-12345',
        title: 'Constantinople',
        variants: ['Byzantium', 'Istanbul', 'Konstantiniyye'],
        ccodes: ['TR'],
        minmax: [330, 1453],
        timespans: [{ start: { in: 330 }, end: { in: 1453 } }],
      },
      geometry: {
        type: 'Point',
        coordinates: [28.9784, 41.0082],
      },
    },
  ],
};

describe('WHGClient', () => {
  let client: WHGClient;

  beforeEach(() => {
    client = new WHGClient();
    vi.restoreAllMocks();
  });

  it('parses a successful WHG response into PlaceMetadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockWHGResponse), { status: 200 }),
    );

    const result = await client.search('Constantinople');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Constantinople');
    expect(result!.coordinates).toEqual([28.9784, 41.0082]);
    expect(result!.aliases).toContain('Byzantium');
    expect(result!.source).toBe('whg');
    expect(result!.sourceId).toBe('whg-12345');
    expect(result!.historicalContext).toHaveLength(1);
    expect(result!.historicalContext![0].yearStart).toBe(330);
    expect(result!.historicalContext![0].yearEnd).toBe(1453);
  });

  it('returns null for empty results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }),
    );

    const result = await client.search('NonexistentPlace');
    expect(result).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 500 }));

    const result = await client.search('Constantinople');
    expect(result).toBeNull();
  });

  it('includes year parameter when yearHint is provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockWHGResponse), { status: 200 }),
    );

    await client.search('Constantinople', { yearHint: 1453 });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('year=1453');
  });

  it('extracts historical context from minmax when no timespans', async () => {
    const noTimespans = {
      ...mockWHGResponse,
      features: [
        {
          ...mockWHGResponse.features[0],
          properties: {
            ...mockWHGResponse.features[0].properties,
            timespans: undefined,
          },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(noTimespans), { status: 200 }),
    );

    const result = await client.search('Constantinople');
    expect(result!.historicalContext).toHaveLength(1);
    expect(result!.historicalContext![0].yearStart).toBe(330);
    expect(result!.historicalContext![0].yearEnd).toBe(1453);
  });
});
