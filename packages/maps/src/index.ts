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

// Presets
export { MAP_PRESETS, getPreset, PRESET_IDS } from './presets';

// Components
export { MapView } from './components/MapView';
export type { MapViewProps } from './components/MapView';
export { MapAnnotationLayer } from './components/MapAnnotationLayer';

// Hooks
export { useMapbox } from './hooks/useMapbox';
