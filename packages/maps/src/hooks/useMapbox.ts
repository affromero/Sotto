'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
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
  onMapLoad,
}: UseMapboxOptions): UseMapboxReturn {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const onMapLoadRef = useRef(onMapLoad);
  onMapLoadRef.current = onMapLoad;

  const initMap = useCallback(() => {
    if (!container.current || mapRef.current) return;

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
      attributionControl: false,
    });

    map.on('error', (e) => {
      console.error('[MapView] Mapbox error:', e.error?.message ?? e);
    });

    map.on('load', () => {
      if (presetConfig.terrain3d) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      }

      setIsLoaded(true);
      onMapLoadRef.current?.(map);
    });

    mapRef.current = map;
  }, [container, center, zoom, pitch, bearing, preset, mapboxToken, interactive]);

  useEffect(() => {
    initMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setIsLoaded(false);
      }
    };
  }, [initMap]);

  return { map: mapRef.current, isLoaded };
}
