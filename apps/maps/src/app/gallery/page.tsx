'use client';

import { MAP_PRESETS, PRESET_IDS, MapView } from '@sotto/maps';
import type { MapPresetId } from '@sotto/maps';
import styles from './page.module.css';

const DEMO_CENTER: [number, number] = [28.9784, 41.0082]; // Istanbul
const DEMO_ZOOM = 11;

export default function GalleryPage() {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Preset Gallery</h1>
      <p className={styles.subtitle}>Istanbul shown in every available style</p>
      <div className={styles.grid}>
        {PRESET_IDS.map((id: MapPresetId) => {
          const preset = MAP_PRESETS[id];
          return (
            <div key={id} className={styles.card}>
              <div className={styles.mapWrapper}>
                <MapView
                  center={DEMO_CENTER}
                  zoom={DEMO_ZOOM}
                  preset={id}
                  mapboxToken={mapboxToken}
                  pitch={preset.pitch}
                  interactive={false}
                />
              </div>
              <div className={styles.cardInfo}>
                <h3 className={styles.presetName}>{preset.name}</h3>
                <p className={styles.presetDesc}>{preset.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
