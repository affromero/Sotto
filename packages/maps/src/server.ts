// Server-safe exports — no React hooks, no mapbox-gl, no 'use client' components
// Use this entry point in API routes and server-side code

// Types
export type {
  PlaceMetadata,
  HistoricalContext,
  PlaceSource,
  MapPresetId,
  MapPreset,
  CameraKeyframe,
  AnimationSequence,
  MapCompositionInput,
  MapAnnotation,
  MapBranding,
  DualEraConfig,
  PlaceResolverOptions,
  ResolveOptions,
  GazetteerClient,
} from './types';

// Resolver
export { PlaceResolver } from './resolver/place-resolver';
export { PlaceCache } from './resolver/cache';
export { WHGClient, GeoNamesClient, PleiadesClient } from './resolver/gazetteers';

// Presets (pure data, no React)
export { MAP_PRESETS, getPreset, PRESET_IDS } from './presets';
