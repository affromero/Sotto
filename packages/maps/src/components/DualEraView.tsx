import { useState, useRef, useCallback } from 'react';
import type { PlaceMetadata, MapPresetId } from '../types';
import { MapView } from './MapView';
import styles from './DualEraView.module.css';

export interface DualEraViewProps {
  place: PlaceMetadata;
  modernPreset?: MapPresetId;
  historicalPreset?: MapPresetId;
  mode: 'side-by-side' | 'slider' | 'overlay-fade';
  mapboxToken: string;
  className?: string;
}

export function DualEraView({
  place,
  modernPreset = 'satellite',
  historicalPreset = 'vintage',
  mode,
  mapboxToken,
  className,
}: DualEraViewProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [fadeOpacity, setFadeOpacity] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleSliderMove = useCallback(
    (clientX: number) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPosition(pct);
    },
    [],
  );

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => handleSliderMove(e.clientX),
    [handleSliderMove],
  );

  if (mode === 'side-by-side') {
    return (
      <div className={`${styles.sideBySide} ${className ?? ''}`}>
        <div className={styles.panel}>
          <MapView center={place.coordinates} zoom={12} preset={modernPreset} mapboxToken={mapboxToken} />
          <div className={styles.panelLabel}>Modern</div>
        </div>
        <div className={styles.divider} />
        <div className={styles.panel}>
          <MapView center={place.coordinates} zoom={12} preset={historicalPreset} mapboxToken={mapboxToken} />
          <div className={styles.panelLabel}>Historical</div>
        </div>
      </div>
    );
  }

  if (mode === 'overlay-fade') {
    return (
      <div className={`${styles.overlayFade} ${className ?? ''}`}>
        <MapView center={place.coordinates} zoom={12} preset={modernPreset} mapboxToken={mapboxToken} />
        <div className={styles.historicalLayer} style={{ opacity: fadeOpacity }}>
          <MapView center={place.coordinates} zoom={12} preset={historicalPreset} mapboxToken={mapboxToken} interactive={false} />
        </div>
        <div className={styles.fadeControls}>
          <span className={styles.fadeLabel}>Modern</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={fadeOpacity}
            onChange={(e) => setFadeOpacity(parseFloat(e.target.value))}
            className={styles.fadeSlider}
            aria-label="Historical overlay opacity"
          />
          <span className={styles.fadeLabel}>Historical</span>
        </div>
      </div>
    );
  }

  // Slider mode
  return (
    <div
      ref={containerRef}
      className={`${styles.slider} ${className ?? ''}`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <MapView center={place.coordinates} zoom={12} preset={modernPreset} mapboxToken={mapboxToken} />
      <div className={styles.sliderHistorical} style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}>
        <MapView center={place.coordinates} zoom={12} preset={historicalPreset} mapboxToken={mapboxToken} interactive={false} />
      </div>
      <div
        className={styles.sliderHandle}
        style={{ left: `${sliderPosition}%` }}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-valuenow={sliderPosition}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Slide to compare modern and historical views"
        tabIndex={0}
      >
        <div className={styles.sliderGrip} />
      </div>
    </div>
  );
}
