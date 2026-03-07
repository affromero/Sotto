import { useMemo } from 'react';
import styles from './TimeSlider.module.css';

interface TimeEvent {
  year: number;
  label: string;
}

export interface TimeSliderProps {
  minYear: number;
  maxYear: number;
  value: number;
  onChange: (year: number) => void;
  events?: TimeEvent[];
  className?: string;
}

export function TimeSlider({ minYear, maxYear, value, onChange, events = [], className }: TimeSliderProps) {
  const formatYear = (year: number) => (year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`);

  const eventMarkers = useMemo(
    () =>
      events
        .filter((e) => e.year >= minYear && e.year <= maxYear)
        .map((e) => ({
          ...e,
          position: ((e.year - minYear) / (maxYear - minYear)) * 100,
        })),
    [events, minYear, maxYear],
  );

  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      <div className={styles.labels}>
        <span className={styles.yearLabel}>{formatYear(minYear)}</span>
        <span className={styles.currentYear}>{formatYear(value)}</span>
        <span className={styles.yearLabel}>{formatYear(maxYear)}</span>
      </div>
      <div className={styles.track}>
        <input
          type="range"
          min={minYear}
          max={maxYear}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className={styles.slider}
          aria-label={`Year: ${formatYear(value)}`}
        />
        {eventMarkers.map((marker) => (
          <div
            key={marker.year}
            className={styles.eventMarker}
            style={{ left: `${marker.position}%` }}
            title={`${formatYear(marker.year)}: ${marker.label}`}
          />
        ))}
      </div>
    </div>
  );
}
