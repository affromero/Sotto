import type { GazetteerClient, PlaceMetadata, ResolveOptions } from '../../types';

interface GeoNameResult {
  geonameId: number;
  name: string;
  toponymName: string;
  alternateNames?: Array<{ name: string; lang?: string }>;
  lng: string;
  lat: string;
  countryName?: string;
  adminName1?: string;
  fcl: string;
  fcode: string;
  population?: number;
  bbox?: {
    west: number;
    east: number;
    north: number;
    south: number;
  };
}

interface GeoNamesResponse {
  totalResultsCount: number;
  geonames: GeoNameResult[];
}

function resultToPlace(result: GeoNameResult): PlaceMetadata {
  const aliases = result.alternateNames?.map((an) => an.name).slice(0, 10) ?? [];
  const region = [result.adminName1, result.countryName].filter(Boolean).join(', ');

  return {
    name: result.toponymName,
    aliases,
    coordinates: [parseFloat(result.lng), parseFloat(result.lat)],
    modernRegion: region,
    bbox: result.bbox
      ? [result.bbox.west, result.bbox.south, result.bbox.east, result.bbox.north]
      : undefined,
    source: 'geonames',
    sourceId: String(result.geonameId),
    confidence: result.fcl === 'P' ? 0.9 : 0.7,
  };
}

export class GeoNamesClient implements GazetteerClient {
  readonly source = 'geonames' as const;
  private readonly baseUrl = 'https://secure.geonames.org';
  private readonly username: string;

  constructor(username?: string) {
    this.username = username ?? process.env.GEONAMES_USERNAME ?? '';
  }

  async search(query: string, _options?: ResolveOptions): Promise<PlaceMetadata | null> {
    if (!this.username) {
      console.warn('[maps:geonames] GEONAMES_USERNAME not configured, skipping');
      return null;
    }

    const params = new URLSearchParams({
      q: query,
      maxRows: '1',
      username: this.username,
      type: 'json',
      style: 'FULL',
    });

    const url = `${this.baseUrl}/searchJSON?${params.toString()}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn('[maps:geonames] API error', { status: response.status, query });
      return null;
    }

    const data = (await response.json()) as GeoNamesResponse;
    if (!data.geonames?.length) return null;

    return resultToPlace(data.geonames[0]);
  }
}
