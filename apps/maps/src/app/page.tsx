'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { SearchBar } from '@/components/SearchBar';
import { PresetPicker } from '@/components/PresetPicker';
import {
  MapView, TimeSlider,
  addOHMOverlay, updateOHMYear, removeOHMOverlay,
  findHistoricalMaps,
} from '@sotto/maps';
import type { PlaceMetadata, MapPresetId, AntiqueMapResult } from '@sotto/maps';
import styles from './page.module.css';

const GLOBE_CENTER: [number, number] = [12, 30];
const GLOBE_ZOOM = 1.8;

/** Hide modern labels (roads, cities, POIs) from the base map style */
function setBaseLabelsVisible(map: MapboxMap, visible: boolean) {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    // Skip our own OHM layers
    if (layer.id.startsWith('ohm-')) continue;
    if (layer.type === 'symbol') {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

export default function HomePage() {
  const [place, setPlace] = useState<PlaceMetadata | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [preset, setPreset] = useState<MapPresetId>('vintage');
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [antiqueMaps, setAntiqueMaps] = useState<AntiqueMapResult[]>([]);
  const [antiqueMapLoading, setAntiqueMapLoading] = useState(false);
  const [showAntiqueMaps, setShowAntiqueMaps] = useState(false);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const mapRef = useRef<MapboxMap | null>(null);
  const ohmLoadedRef = useRef(false);
  const yearRef = useRef<number | null>(null);
  const labelsHiddenRef = useRef(false);

  const loadOHM = useCallback((map: MapboxMap, y: number) => {
    if (ohmLoadedRef.current) {
      removeOHMOverlay(map);
    }
    addOHMOverlay({ map, year: y });
    ohmLoadedRef.current = true;
  }, []);

  const handleMapLoad = useCallback((map: MapboxMap) => {
    mapRef.current = map;
    map.setFog({
      color: 'rgb(186, 210, 235)',
      'high-color': 'rgb(36, 92, 223)',
      'horizon-blend': 0.02,
      'space-color': 'rgb(11, 11, 25)',
      'star-intensity': 0.6,
    });

    map.on('style.load', () => {
      ohmLoadedRef.current = false;
      if (yearRef.current != null) {
        setTimeout(() => {
          if (mapRef.current && yearRef.current != null) {
            loadOHM(mapRef.current, yearRef.current);
            // Re-apply label visibility after style change
            if (labelsHiddenRef.current) {
              setBaseLabelsVisible(mapRef.current, false);
            }
          }
        }, 200);
      }
    });
  }, [loadOHM]);

  const flyToPlace = useCallback((p: PlaceMetadata, y: number | null) => {
    const map = mapRef.current;
    if (!map) return;

    // When a historical year is provided, zoom out to see empire-level boundaries
    // OHM boundary data is most visible at z5-z8, sparse at z10+
    const hasHistorical = y != null;
    const zoom = p.bbox ? 7 : hasHistorical ? 6 : 10;

    map.flyTo({
      center: p.coordinates,
      zoom,
      pitch: hasHistorical ? 30 : 45,
      bearing: 0,
      duration: 4000,
      curve: 1.42,
      essential: true,
    });

    map.once('moveend', () => {
      if (y != null) {
        loadOHM(map, y);
        // Auto-hide labels for historical views
        if (!labelsHiddenRef.current) {
          labelsHiddenRef.current = true;
          setLabelsHidden(true);
          setBaseLabelsVisible(map, false);
        }
      }
    });
  }, [loadOHM]);

  const toggleLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const newVisible = labelsHiddenRef.current;
    labelsHiddenRef.current = !newVisible;
    setLabelsHidden(!newVisible);
    setBaseLabelsVisible(map, newVisible);
  }, []);

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
    setAntiqueMaps([]);
    setShowAntiqueMaps(false);
    try {
      const params = new URLSearchParams({ q: query });
      if (parsedYear != null) params.set('year', String(parsedYear));
      const res = await fetch(`/api/v1/resolve?${params.toString()}`);
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

  const loadAntiqueMaps = useCallback(async () => {
    if (!place) return;

    if (showAntiqueMaps) {
      setShowAntiqueMaps(false);
      return;
    }

    setAntiqueMapLoading(true);
    const maps = await findHistoricalMaps(place.name, 6);
    setAntiqueMaps(maps);
    setShowAntiqueMaps(true);
    setAntiqueMapLoading(false);
  }, [place, showAntiqueMaps]);

  useEffect(() => {
    yearRef.current = year;
  }, [year]);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  // Slider range: include the searched year AND any historical context
  const contextStart = place?.historicalContext?.[0]?.yearStart;
  const baseMin = year != null ? year - 200 : -500;
  const minYear = contextStart != null ? Math.min(contextStart, baseMin) : baseMin;
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
            className={`${styles.antiqueToggle} ${showAntiqueMaps ? styles.antiqueActive : ''}`}
            onClick={loadAntiqueMaps}
            disabled={antiqueMapLoading}
          >
            {antiqueMapLoading ? 'Searching...' : showAntiqueMaps ? 'Hide Antique Maps' : 'Browse Antique Maps'}
          </button>
        </div>
      )}

      {showAntiqueMaps && (
        <div className={styles.antiquePanel}>
          <h3 className={styles.antiquePanelTitle}>
            Antique Maps{antiqueMaps.length > 0 && ` (${antiqueMaps.length})`}
          </h3>
          {antiqueMaps.length === 0 ? (
            <p className={styles.antiqueEmpty}>No antique maps found for this location</p>
          ) : (
            <div className={styles.antiqueGrid}>
              {antiqueMaps.map((m, i) => (
                <a
                  key={i}
                  href={m.viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.antiqueCard}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumbnailUrl} alt={m.title} className={styles.antiqueThumb} />
                  <div className={styles.antiqueCardInfo}>
                    <span className={styles.antiqueCardTitle}>{m.title}</span>
                    {m.date && <span className={styles.antiqueCardDate}>{m.date}</span>}
                  </div>
                </a>
              ))}
            </div>
          )}
          <p className={styles.antiqueAttribution}>
            Maps courtesy of the{' '}
            <a href="https://www.davidrumsey.com" target="_blank" rel="noopener noreferrer">
              David Rumsey Map Collection
            </a>
            , Stanford Libraries
          </p>
        </div>
      )}

      {hasSearched && year != null && (
        <div className={styles.timeSliderContainer}>
          <div className={styles.sliderRow}>
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
            <button
              type="button"
              className={`${styles.labelToggle} ${labelsHidden ? styles.labelToggleActive : ''}`}
              onClick={toggleLabels}
              title={labelsHidden ? 'Show modern labels' : 'Hide modern labels'}
            >
              {labelsHidden ? 'Aa' : 'Aa'}
            </button>
          </div>
          <p className={styles.ohmNote}>
            Historical borders from OpenHistoricalMap — coverage varies by region and era
          </p>
        </div>
      )}

      {!hasSearched && (
        <div className={styles.hint}>
          <p>Search for a place to explore</p>
          <p className={styles.hintExamples}>
            Try: &quot;Rome 44 BCE&quot;, &quot;Constantinople 1453&quot;, &quot;Paris 1789&quot;, &quot;Cusco 1400&quot;
          </p>
        </div>
      )}
    </div>
  );
}
