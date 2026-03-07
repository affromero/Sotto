'use client';

import { useState, useCallback, useRef } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { SearchBar } from '@/components/SearchBar';
import { PresetPicker } from '@/components/PresetPicker';
import { MapView, TimeSlider, addOHMOverlay, updateOHMYear, removeOHMOverlay } from '@sotto/maps';
import type { PlaceMetadata, MapPresetId } from '@sotto/maps';
import styles from './page.module.css';

const GLOBE_CENTER: [number, number] = [12, 30];
const GLOBE_ZOOM = 1.8;

export default function HomePage() {
  const [place, setPlace] = useState<PlaceMetadata | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [preset, setPreset] = useState<MapPresetId>('vintage');
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const mapRef = useRef<MapboxMap | null>(null);
  const ohmLoadedRef = useRef(false);

  const handleMapLoad = useCallback((map: MapboxMap) => {
    mapRef.current = map;
    // Atmosphere for globe effect
    map.setFog({
      color: 'rgb(186, 210, 235)',
      'high-color': 'rgb(36, 92, 223)',
      'horizon-blend': 0.02,
      'space-color': 'rgb(11, 11, 25)',
      'star-intensity': 0.6,
    });
  }, []);

  const flyToPlace = useCallback((p: PlaceMetadata, y: number | null) => {
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: p.coordinates,
      zoom: p.bbox ? 8 : 11,
      pitch: 45,
      bearing: 0,
      duration: 4000,
      curve: 1.42,
      essential: true,
    });

    // Add OHM overlay after fly-in completes
    map.once('moveend', () => {
      if (ohmLoadedRef.current) {
        removeOHMOverlay(map);
        ohmLoadedRef.current = false;
      }
      if (y != null) {
        addOHMOverlay({ map, year: y });
        ohmLoadedRef.current = true;
      }
    });
  }, []);

  const handleYearChange = useCallback((newYear: number) => {
    setYear(newYear);
    const map = mapRef.current;
    if (!map) return;

    if (!ohmLoadedRef.current) {
      addOHMOverlay({ map, year: newYear });
      ohmLoadedRef.current = true;
    } else {
      updateOHMYear(map, newYear);
    }
  }, []);

  const handleSearch = useCallback(async (query: string, parsedYear?: number) => {
    setError(null);
    try {
      const params = new URLSearchParams({ q: query });
      if (parsedYear != null) params.set('year', String(parsedYear));
      const res = await fetch(`/api/resolve?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Place not found');
        return;
      }
      const data: PlaceMetadata = await res.json();
      setPlace(data);
      setYear(parsedYear ?? null);
      setHasSearched(true);
      flyToPlace(data, parsedYear ?? null);
    } catch {
      setError('Failed to resolve place');
    }
  }, [flyToPlace]);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  // Derive time range from place context or default
  const minYear = place?.historicalContext?.[0]?.yearStart ?? (year != null ? year - 500 : -500);
  const maxYear = 2024;

  return (
    <div className={styles.root}>
      <MapView
        center={GLOBE_CENTER}
        zoom={GLOBE_ZOOM}
        pitch={0}
        bearing={0}
        preset={preset}
        mapboxToken={mapboxToken}
        projection="globe"
        onMapLoad={handleMapLoad}
        className={styles.map}
      />

      <div className={styles.overlay}>
        <header className={styles.header}>
          <h1 className={styles.title}>Sotto Maps</h1>
          <p className={styles.subtitle}>Explore historical places with rich map visuals</p>
        </header>

        <div className={styles.controls}>
          <SearchBar onSearch={handleSearch} />
          <PresetPicker value={preset} onChange={setPreset} />
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </div>

      {place && hasSearched && (
        <div className={styles.placeInfo}>
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
          {year != null && (
            <div className={styles.yearBadge}>
              {year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`}
            </div>
          )}
        </div>
      )}

      {hasSearched && year != null && (
        <div className={styles.timeSliderContainer}>
          <TimeSlider
            minYear={minYear}
            maxYear={maxYear}
            value={year}
            onChange={handleYearChange}
            events={place?.historicalContext?.map(ctx => ({
              year: ctx.yearStart,
              label: ctx.periodName,
            })) ?? []}
          />
        </div>
      )}

      {!hasSearched && (
        <div className={styles.hint}>
          <p>Search for a place to explore</p>
          <p className={styles.hintExamples}>
            Try: &quot;Rome 44 BCE&quot;, &quot;Constantinople 1453&quot;, &quot;Jerusalem 70 CE&quot;
          </p>
        </div>
      )}
    </div>
  );
}
