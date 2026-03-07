import { useRef } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { MapPresetId } from '../types';
import { MAP_PRESETS } from '../presets';
import { useMapbox } from '../hooks/useMapbox';
import styles from './MapView.module.css';

export interface MapViewProps {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
  preset?: MapPresetId;
  mapboxToken: string;
  interactive?: boolean;
  onMapLoad?: (map: MapboxMap) => void;
  children?: React.ReactNode;
  className?: string;
}

export function MapView({
  center,
  zoom,
  pitch,
  bearing,
  preset = 'vintage',
  mapboxToken,
  interactive = true,
  onMapLoad,
  children,
  className,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const presetConfig = MAP_PRESETS[preset];

  useMapbox({
    container: containerRef,
    center,
    zoom,
    pitch,
    bearing,
    preset,
    mapboxToken,
    interactive,
    onMapLoad,
  });

  const hasTexture = !!presetConfig.textureOverlay;
  const overlayFilter = presetConfig.overlayFilter;

  return (
    <div
      className={`${styles.root} ${className ?? ''}`}
      style={overlayFilter ? ({ '--map-overlay-filter': overlayFilter } as React.CSSProperties) : undefined}
    >
      <div ref={containerRef} className={styles.container} />
      {hasTexture && <div className={`${styles.textureOverlay} ${styles[presetConfig.textureOverlay!]}`} />}
      {children && <div className={styles.content}>{children}</div>}
    </div>
  );
}
