// OSS stub for `@sotto/maps/server`.
//
// The real maps package (historical place resolution + map visuals for the
// video pipeline) is a private submodule. In the open-source build it is
// replaced by this no-op stub: place resolution returns nothing, so the
// video map-visual feature is simply inactive. The types mirror the real
// package exactly, so every call site type-checks unchanged.

export interface HistoricalContext {
  yearStart: number;
  yearEnd?: number;
  periodName: string;
  polity?: string;
  significance?: string;
}

export type PlaceSource = 'whg' | 'pleiades' | 'geonames' | 'claude' | 'manual';

export interface PlaceMetadata {
  name: string;
  aliases: string[];
  coordinates: [number, number]; // [lng, lat]
  modernRegion: string;
  historicalContext?: HistoricalContext[];
  bbox?: [number, number, number, number];
  source: PlaceSource;
  sourceId?: string;
  confidence: number;
}

export type MapPresetId = 'vintage' | 'satellite' | 'parchment' | 'cinematic' | 'dark' | 'terrain';

export interface MapPreset {
  id: MapPresetId;
  name: string;
  description: string;
  styleUrl: string;
  terrain3d: boolean;
  pitch: number;
  overlayFilter?: string;
  textureOverlay?: string;
}

export interface PlaceResolverOptions {
  redisUrl?: string;
  [key: string]: unknown;
}

export interface ResolveOptions {
  yearHint?: number;
  [key: string]: unknown;
}

export interface AntiqueMapResult {
  id: string;
  title: string;
  imageUrl: string;
  year?: number;
  [key: string]: unknown;
}

/** No-op resolver: the OSS build ships no historical place resolution. */
export class PlaceResolver {
  constructor(_options: PlaceResolverOptions = {}) {}

  resolve(_query: string, _options?: ResolveOptions): Promise<PlaceMetadata | null> {
    return Promise.resolve(null);
  }

  resolveBatch(
    queries: Array<{ query: string; options?: ResolveOptions }>
  ): Promise<Array<PlaceMetadata | null>> {
    return Promise.resolve(queries.map(() => null));
  }

  resolveHistorical(_query: string, _yearHint?: number): Promise<PlaceMetadata | null> {
    return Promise.resolve(null);
  }
}

export function findHistoricalMaps(_placeName: string, _limit = 5): Promise<AntiqueMapResult[]> {
  return Promise.resolve([]);
}

export const PRESET_IDS: MapPresetId[] = [
  'vintage',
  'satellite',
  'parchment',
  'cinematic',
  'dark',
  'terrain',
];

export const MAP_PRESETS: Record<MapPresetId, MapPreset> = PRESET_IDS.reduce(
  (acc, id) => {
    acc[id] = { id, name: id, description: '', styleUrl: '', terrain3d: false, pitch: 0 };
    return acc;
  },
  {} as Record<MapPresetId, MapPreset>
);

export function getPreset(id: MapPresetId): MapPreset {
  return MAP_PRESETS[id];
}
