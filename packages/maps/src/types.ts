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

export interface HistoricalContext {
  yearStart: number;
  yearEnd?: number;
  periodName: string;
  polity?: string;
  significance?: string;
}

export type PlaceSource = 'whg' | 'pleiades' | 'geonames' | 'claude' | 'manual';

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

export interface CameraKeyframe {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  duration: number;
  easing: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';
}

export interface AnimationSequence {
  id: string;
  keyframes: CameraKeyframe[];
  totalDuration: number;
  places: PlaceMetadata[];
}

export interface MapCompositionInput {
  places: PlaceMetadata[];
  preset: MapPresetId;
  sequence: AnimationSequence;
  historicalYear?: number;
  iiifManifestUrl?: string;
  annotations?: MapAnnotation[];
  branding: MapBranding;
}

export interface MapAnnotation {
  text: string;
  coordinates: [number, number];
  style: 'label' | 'callout' | 'marker';
}

export interface MapBranding {
  primaryColor: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
}

export interface DualEraConfig {
  place: PlaceMetadata;
  modernPreset: MapPresetId;
  historicalYear: number;
  iiifManifest?: string;
  mode: 'side-by-side' | 'slider' | 'overlay-fade';
}

export interface PlaceResolverOptions {
  redisUrl?: string;
  cacheTtlSeconds?: number;
  gazetteers?: PlaceSource[];
}

export interface ResolveOptions {
  yearHint?: number;
}

export interface GazetteerClient {
  search(query: string, options?: ResolveOptions): Promise<PlaceMetadata | null>;
  readonly source: PlaceSource;
}
