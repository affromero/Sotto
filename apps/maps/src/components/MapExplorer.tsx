'use client';

import { MapView } from '@sotto/maps';
import type { PlaceMetadata, MapPresetId } from '@sotto/maps';
import styles from './MapExplorer.module.css';

interface MapExplorerProps {
  place: PlaceMetadata;
  preset: MapPresetId;
}

export function MapExplorer({ place, preset }: MapExplorerProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <div className={styles.root}>
      <MapView
        center={place.coordinates}
        zoom={place.bbox ? 8 : 12}
        preset={preset}
        mapboxToken={mapboxToken}
      />
      <div className={styles.info}>
        <h2 className={styles.placeName}>{place.name}</h2>
        {place.aliases.length > 0 && (
          <p className={styles.aliases}>Also known as: {place.aliases.slice(0, 5).join(', ')}</p>
        )}
        {place.modernRegion && <p className={styles.region}>{place.modernRegion}</p>}
        {place.historicalContext?.map((ctx, i) => (
          <span key={i} className={styles.period}>
            {ctx.periodName}
            {ctx.yearStart && ` (${ctx.yearStart < 0 ? `${Math.abs(ctx.yearStart)} BCE` : ctx.yearStart}`}
            {ctx.yearEnd && `–${ctx.yearEnd < 0 ? `${Math.abs(ctx.yearEnd)} BCE` : ctx.yearEnd}`}
            {ctx.yearStart && ')'}
          </span>
        ))}
      </div>
    </div>
  );
}
