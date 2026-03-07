'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { SearchBar } from '@/components/SearchBar';
import { PresetPicker } from '@/components/PresetPicker';
import {
  MapView, TimeSlider,
  addOHMOverlay, updateOHMYear, removeOHMOverlay,
  addAllmapsOverlay, removeAllmapsOverlay,
} from '@sotto/maps';
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
  const [antiqueMapLoaded, setAntiqueMapLoaded] = useState(false);
  const [antiqueMapLoading, setAntiqueMapLoading] = useState(false);
  const mapRef = useRef<MapboxMap | null>(null);
  const ohmLoadedRef = useRef(false);
  const yearRef = useRef<number | null>(null);

  const loadOHM = useCallback((map: MapboxMap, y: number) => {
    if (ohmLoadedRef.current) {
      removeOHMOverlay(map);
    }
    addOHMOverlay({ map, year: y });
    ohmLoadedRef.current = true;
  }, []);

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

    // Re-add OHM overlay after style changes (preset switch)
    map.on('style.load', () => {
      ohmLoadedRef.current = false;
      if (yearRef.current != null) {
        // Small delay to let the style fully settle
        setTimeout(() => {
          if (mapRef.current && yearRef.current != null) {
            loadOHM(mapRef.current, yearRef.current);
          }
        }, 200);
      }
    });
  }, [loadOHM]);

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
      if (y != null) {
        loadOHM(map, y);
      }
    });
  }, [loadOHM]);

  const handleYearChange = useCallback((newYear: number) => {
    setYear(newYear);
    yearRef.current = newYear;
    const map = mapRef.current;
    if (!map) return;

    if (!ohmLoadedRef.current) {
      loadOHM(map, newYear);
    } else {
      updateOHMYear(map, newYear);
    }
  }, [loadOHM]);

  const handleSearch = useCallback(async (query: string, parsedYear?: number) => {
    setError(null);
    setAntiqueMapLoaded(false);
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
      const y = parsedYear ?? null;
      setYear(y);
      yearRef.current = y;
      setHasSearched(true);
      flyToPlace(data, y);
    } catch {
      setError('Failed to resolve place');
    }
  }, [flyToPlace]);

  const toggleAntiqueMap = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !place) return;

    if (antiqueMapLoaded) {
      removeAllmapsOverlay(map);
      setAntiqueMapLoaded(false);
      return;
    }

    setAntiqueMapLoading(true);
    const success = await addAllmapsOverlay({
      map,
      coordinates: place.coordinates,
      bbox: place.bbox ?? undefined,
    });
    setAntiqueMapLoaded(success);
    setAntiqueMapLoading(false);
  }, [place, antiqueMapLoaded]);

  // Keep yearRef in sync
  useEffect(() => {
    yearRef.current = year;
  }, [year]);

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
          <button
            type="button"
            className={`${styles.antiqueToggle} ${antiqueMapLoaded ? styles.antiqueActive : ''}`}
            onClick={toggleAntiqueMap}
            disabled={antiqueMapLoading}
          >
            {antiqueMapLoading ? 'Searching...' : antiqueMapLoaded ? 'Hide Antique Map' : 'Show Antique Map'}
          </button>
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
          <p className={styles.ohmNote}>
            Historical borders from OpenHistoricalMap — coverage varies by region and era
          </p>
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
