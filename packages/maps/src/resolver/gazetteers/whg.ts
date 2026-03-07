import type { GazetteerClient, PlaceMetadata, HistoricalContext, ResolveOptions } from '../../types';

interface WHGFeature {
  type: 'Feature';
  properties: {
    pid: string;
    title: string;
    variants?: string[];
    ccodes?: string[];
    minmax?: [number, number];
    timespans?: Array<{ start: { in: number }; end?: { in: number } }>;
    descriptions?: Array<{ value: string }>;
  };
  geometry: {
    type: string;
    coordinates: [number, number];
  };
}

interface WHGResponse {
  type: 'FeatureCollection';
  features: WHGFeature[];
}

function extractHistoricalContext(feature: WHGFeature): HistoricalContext[] {
  const timespans = feature.properties.timespans;
  if (!timespans?.length) {
    const minmax = feature.properties.minmax;
    if (!minmax) return [];
    return [
      {
        yearStart: minmax[0],
        yearEnd: minmax[1],
        periodName: 'Historical',
      },
    ];
  }

  return timespans.map((ts) => ({
    yearStart: ts.start.in,
    yearEnd: ts.end?.in,
    periodName: 'Historical',
  }));
}

function featureToPlace(feature: WHGFeature): PlaceMetadata {
  return {
    name: feature.properties.title,
    aliases: feature.properties.variants ?? [],
    coordinates: feature.geometry.coordinates,
    modernRegion: feature.properties.ccodes?.join(', ') ?? '',
    historicalContext: extractHistoricalContext(feature),
    source: 'whg',
    sourceId: feature.properties.pid,
    confidence: 0.8,
  };
}

export class WHGClient implements GazetteerClient {
  readonly source = 'whg' as const;
  private readonly baseUrl = 'https://whgazetteer.org/api';

  async search(query: string, options?: ResolveOptions): Promise<PlaceMetadata | null> {
    const params = new URLSearchParams({ name: query });
    if (options?.yearHint) {
      params.set('year', String(options.yearHint));
    }

    const url = `${this.baseUrl}/index/?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn('[maps:whg] API error', { status: response.status, query });
      return null;
    }

    const data = (await response.json()) as WHGResponse;
    if (!data.features?.length) return null;

    const best = data.features[0];
    return featureToPlace(best);
  }
}
