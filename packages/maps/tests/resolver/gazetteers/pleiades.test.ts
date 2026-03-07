import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PleiadesClient } from '../../../src/resolver/gazetteers/pleiades';

const mockPleiadesResponse = {
  items: [
    {
      id: '520998',
      title: 'Roma',
      description: 'An ancient place in the Roman Empire',
      uri: 'https://pleiades.stoa.org/places/520998',
      reprLat: '41.891775',
      reprLong: '12.486137',
      names: ['Rome', 'Roma'],
      timePeriodsKeys: ['classical', 'roman', 'late-antique'],
    },
  ],
};

describe('PleiadesClient', () => {
  let client: PleiadesClient;

  beforeEach(() => {
    client = new PleiadesClient();
    vi.restoreAllMocks();
  });

  it('parses a successful Pleiades response into PlaceMetadata', async () => {
    // First fetch (KML search) returns non-OK to trigger JSON fallback
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockPleiadesResponse), { status: 200 }));

    const result = await client.search('Roma');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Roma');
    expect(result!.coordinates).toEqual([12.486137, 41.891775]);
    expect(result!.aliases).toContain('Rome');
    expect(result!.source).toBe('pleiades');
    expect(result!.sourceId).toBe('520998');
    expect(result!.confidence).toBe(0.85);
  });

  it('extracts historical context from period keys', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockPleiadesResponse), { status: 200 }));

    const result = await client.search('Roma');

    expect(result!.historicalContext).toHaveLength(3);
    expect(result!.historicalContext![0].periodName).toBe('Classical');
    expect(result!.historicalContext![0].yearStart).toBe(-550);
    expect(result!.historicalContext![1].periodName).toBe('Roman');
    expect(result!.historicalContext![2].periodName).toBe('Late Antique');
  });

  it('returns null when place has no coordinates', async () => {
    const noCoords = {
      items: [{ ...mockPleiadesResponse.items[0], reprLat: undefined, reprLong: undefined }],
    };

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(noCoords), { status: 200 }));

    const result = await client.search('Unknown Place');
    expect(result).toBeNull();
  });

  it('returns null for empty results', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));

    const result = await client.search('NonexistentPlace');
    expect(result).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const result = await client.search('Roma');
    expect(result).toBeNull();
  });
});
