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
export { findHistoricalMaps } from './overlays/allmaps-overlay';
export type { AntiqueMapResult } from './overlays/allmaps-overlay';
export { addOHMOverlay, removeOHMOverlay, updateOHMYear } from './overlays/ohm-overlay';

export { MapSequence } from './components/MapSequence';
export type { MapSequenceProps } from './components/MapSequence';

// Animations
export { flyToPlace, flyBetween } from './animations/fly-to';
export type { FlyToOptions } from './animations/fly-to';
export { interpolateKeyframes, animateCameraPath } from './animations/camera-path';
export { animateOverlayFade } from './animations/overlay-fade';
export type { OverlayFadeParams } from './animations/overlay-fade';
export { animateMaskReveal } from './animations/mask-reveal';
export type { MaskRevealParams } from './animations/mask-reveal';
export { SequenceBuilder } from './animations/sequence-builder';

// Hooks
export { useMapbox } from './hooks/useMapbox';
