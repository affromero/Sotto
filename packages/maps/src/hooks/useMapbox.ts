'use client';

import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { MapPresetId } from '../types';
import { MAP_PRESETS } from '../presets';

interface UseMapboxOptions {
  container: React.RefObject<HTMLDivElement | null>;
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
  preset?: MapPresetId;
  mapboxToken: string;
  interactive?: boolean;
  projection?: 'mercator' | 'globe';
  onMapLoad?: (map: mapboxgl.Map) => void;
}

interface UseMapboxReturn {
  map: mapboxgl.Map | null;
  isLoaded: boolean;
}

export function useMapbox({
  container,
  center,
  zoom,
  pitch,
  bearing,
  preset = 'vintage',
  mapboxToken,
  interactive = true,
  projection,
  onMapLoad,
}: UseMapboxOptions): UseMapboxReturn {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const onMapLoadRef = useRef(onMapLoad);
  onMapLoadRef.current = onMapLoad;
  const presetRef = useRef(preset);
  const initializedRef = useRef(false);

  // Create map once
  useEffect(() => {
    if (!container.current || initializedRef.current) return;
    initializedRef.current = true;

    const presetConfig = MAP_PRESETS[preset];
    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: container.current,
      style: presetConfig.styleUrl,
      center,
      zoom,
      pitch: pitch ?? presetConfig.pitch,
      bearing: bearing ?? 0,
      interactive,
      projection: projection ?? 'mercator',
      attributionControl: false,
    });

    map.on('error', (e) => {
      console.error('[MapView] Mapbox error:', e.error?.message ?? e);
    });

    const applyTerrain = (config: typeof presetConfig) => {
      if (config.terrain3d) {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      } else {
        map.setTerrain(null);
      }
    };

    map.on('load', () => {
      applyTerrain(presetConfig);
      setIsLoaded(true);
      onMapLoadRef.current?.(map);
    });

    // Re-apply terrain after style changes
    map.on('style.load', () => {
      const currentConfig = MAP_PRESETS[presetRef.current];
      applyTerrain(currentConfig);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      initializedRef.current = false;
      setIsLoaded(false);
    };
    // Only run on mount/unmount — all updates go through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, mapboxToken]);

  // Style change (preset switch) — no new map load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    if (presetRef.current === preset) return;

    presetRef.current = preset;
    const config = MAP_PRESETS[preset];
    map.setStyle(config.styleUrl);
  }, [preset, isLoaded]);

  return { map: mapRef.current, isLoaded };
}
