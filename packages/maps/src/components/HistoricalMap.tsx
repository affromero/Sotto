'use client';

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { PlaceMetadata, MapPresetId, MapAnnotation } from '../types';
import { MapView } from './MapView';
import { MapAnnotationLayer } from './MapAnnotationLayer';
import { addOHMOverlay } from '../overlays/ohm-overlay';
import styles from './HistoricalMap.module.css';

export interface HistoricalMapProps {
  place: PlaceMetadata;
  year?: number;
  preset?: MapPresetId;
  mapboxToken: string;
  showOHM?: boolean;
  annotations?: MapAnnotation[];
  className?: string;
}

export function HistoricalMap({
  place,
  year,
  preset = 'vintage',
  mapboxToken,
  showOHM = false,
  annotations,
  className,
}: HistoricalMapProps) {
  const handleMapLoad = useCallback(
    (map: MapboxMap) => {
      if (showOHM) {
        addOHMOverlay({ map, year });
      }
    },
    [showOHM, year],
  );

  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      <MapView
        center={place.coordinates}
        zoom={place.bbox ? 8 : 12}
        preset={preset}
        mapboxToken={mapboxToken}
        onMapLoad={handleMapLoad}
      >
        {annotations && <MapAnnotationLayer annotations={annotations} />}
      </MapView>
      {year && (
        <div className={styles.yearBadge}>
          <span>{year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`}</span>
        </div>
      )}
    </div>
  );
}
