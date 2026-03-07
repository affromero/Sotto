import type { MapPreset, MapPresetId } from '../types';

export const MAP_PRESETS: Record<MapPresetId, MapPreset> = {
  vintage: {
    id: 'vintage',
    name: 'Vintage',
    description: 'Antique paper with sepia tones',
    styleUrl: 'mapbox://styles/mapbox/cj3kbeqzo00022smj7akz3o1e',
    terrain3d: false,
    pitch: 0,
    textureOverlay: 'paper-grain',
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    description: 'Modern satellite imagery',
    styleUrl: 'mapbox://styles/mapbox/satellite-streets-v12',
    terrain3d: false,
    pitch: 0,
  },
  parchment: {
    id: 'parchment',
    name: 'Parchment',
    description: 'Old-world parchment feel',
    styleUrl: 'mapbox://styles/mapbox/light-v11',
    terrain3d: false,
    pitch: 0,
    overlayFilter: 'sepia(0.6) saturate(0.7)',
    textureOverlay: 'parchment-bg',
  },
  cinematic: {
    id: 'cinematic',
    name: 'Cinematic',
    description: 'Dramatic 3D terrain — Johnny Harris style',
    styleUrl: 'mapbox://styles/mapbox/satellite-streets-v12',
    terrain3d: true,
    pitch: 60,
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    description: 'Dark mode map',
    styleUrl: 'mapbox://styles/mapbox/dark-v11',
    terrain3d: false,
    pitch: 0,
  },
  terrain: {
    id: 'terrain',
    name: 'Terrain',
    description: 'Topographic with hillshading',
    styleUrl: 'mapbox://styles/mapbox/outdoors-v12',
    terrain3d: true,
    pitch: 45,
  },
};

export function getPreset(id: MapPresetId): MapPreset {
  return MAP_PRESETS[id];
}

export const PRESET_IDS: MapPresetId[] = Object.keys(MAP_PRESETS) as MapPresetId[];
