'use client';

import { useState, useCallback } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { PresetPicker } from '@/components/PresetPicker';
import { MapExplorer } from '@/components/MapExplorer';
import type { PlaceMetadata, MapPresetId } from '@sotto/maps';
import styles from './page.module.css';

export default function HomePage() {
  const [place, setPlace] = useState<PlaceMetadata | null>(null);
  const [preset, setPreset] = useState<MapPresetId>('vintage');
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async (query: string, year?: number) => {
    setError(null);
    try {
      const params = new URLSearchParams({ q: query });
      if (year != null) params.set('year', String(year));
      const res = await fetch(`/api/resolve?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Place not found');
        return;
      }
      const data = await res.json();
      setPlace(data);
    } catch {
      setError('Failed to resolve place');
    }
  }, []);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Sotto Maps</h1>
        <p className={styles.subtitle}>Explore historical places with rich map visuals</p>
      </header>

      <div className={styles.controls}>
        <SearchBar onSearch={handleSearch} />
        <PresetPicker value={preset} onChange={setPreset} />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.mapContainer}>
        {place ? (
          <MapExplorer place={place} preset={preset} />
        ) : (
          <div className={styles.placeholder}>
            <p>Search for a place to get started</p>
            <p className={styles.examples}>Try: "Rome 44 BCE", "Constantinople 1453", "Machu Picchu"</p>
          </div>
        )}
      </div>
    </div>
  );
}
