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

export { HistoricalMap } from './components/HistoricalMap';
export type { HistoricalMapProps } from './components/HistoricalMap';
export { DualEraView } from './components/DualEraView';
export type { DualEraViewProps } from './components/DualEraView';
export { TimeSlider } from './components/TimeSlider';
export type { TimeSliderProps } from './components/TimeSlider';

// Overlays
export { addAllmapsOverlay, removeAllmapsOverlay } from './overlays/allmaps-overlay';
export { addOHMOverlay, removeOHMOverlay, updateOHMYear } from './overlays/ohm-overlay';

// Hooks
export { useMapbox } from './hooks/useMapbox';
