import type { GazetteerClient, PlaceMetadata, HistoricalContext, ResolveOptions } from '../../types';

interface PleiadesSearchResult {
  id: string;
  title: string;
  description: string;
  uri: string;
  reprLat?: string;
  reprLong?: string;
  names?: string[];
  timePeriodsKeys?: string[];
  timePeriods?: Array<{
    id: string;
    label: string;
    start?: number;
    stop?: number;
  }>;
}

interface PleiadesSearchResponse {
  items: PleiadesSearchResult[];
}

const PLEIADES_PERIODS: Record<string, { start: number; end: number; name: string }> = {
  archaic: { start: -750, end: -550, name: 'Archaic' },
  classical: { start: -550, end: -330, name: 'Classical' },
  hellenistic: { start: -330, end: -31, name: 'Hellenistic-Republican' },
  roman: { start: -31, end: 300, name: 'Roman' },
  'late-antique': { start: 300, end: 640, name: 'Late Antique' },
  medieval: { start: 640, end: 1453, name: 'Medieval' },
};

function periodsToContext(periodKeys: string[]): HistoricalContext[] {
  const contexts: HistoricalContext[] = [];
  for (const key of periodKeys) {
    const period = PLEIADES_PERIODS[key];
    if (period) {
      contexts.push({
        yearStart: period.start,
        yearEnd: period.end,
        periodName: period.name,
      });
    }
  }
  return contexts;
}

function resultToPlace(result: PleiadesSearchResult): PlaceMetadata | null {
  if (!result.reprLat || !result.reprLong) return null;

  return {
    name: result.title,
    aliases: result.names ?? [],
    coordinates: [parseFloat(result.reprLong), parseFloat(result.reprLat)],
    modernRegion: '',
    historicalContext: periodsToContext(result.timePeriodsKeys ?? []),
    source: 'pleiades',
    sourceId: result.id,
    confidence: 0.85,
  };
}

export class PleiadesClient implements GazetteerClient {
  readonly source = 'pleiades' as const;
  private readonly baseUrl = 'https://pleiades.stoa.org';

  async search(query: string, _options?: ResolveOptions): Promise<PlaceMetadata | null> {
    const params = new URLSearchParams({
      SearchableText: query,
      portal_type: 'Place',
    });

    const url = `${this.baseUrl}/search_kml?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // Pleiades search can also be queried via JSON API
      return this.searchJson(query);
    }

    // Fallback to JSON search
    return this.searchJson(query);
  }

  private async searchJson(query: string): Promise<PlaceMetadata | null> {
    const url = `${this.baseUrl}/search?SearchableText=${encodeURIComponent(query)}&portal_type=Place&format=json`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as PleiadesSearchResponse;
    if (!data.items?.length) return null;

    return resultToPlace(data.items[0]);
  }
}
