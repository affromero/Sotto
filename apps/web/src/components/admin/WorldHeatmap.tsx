'use client';

import { useState, useEffect, useCallback } from 'react';
import { COUNTRY_POSITIONS, COUNTRY_POSITION_MAP, VIEWBOX } from './world-map-data';
import styles from './WorldHeatmap.module.css';

interface CountryCount {
  country: string;
  count: number;
}

interface LiveData {
  since: string;
  totalActive: number;
  countries: CountryCount[];
}

interface WorldHeatmapProps {
  initialData: LiveData;
  range?: string;
}

const RANGE_LABELS: Record<string, string> = {
  '15m': 'Active Now',
  '1h': 'Last Hour',
  '1d': 'Last 24 Hours',
  '7d': 'Last 7 Days',
};

const POLL_INTERVAL_MS = 30_000;

/** Map count to a radius (min 4, max 20, log scale). */
function countToRadius(count: number, maxCount: number): number {
  if (maxCount <= 0) return 4;
  const normalized = Math.log(count + 1) / Math.log(maxCount + 1);
  return 4 + normalized * 16;
}

/** Map count to opacity (min 0.4, max 1.0). */
function countToOpacity(count: number, maxCount: number): number {
  if (maxCount <= 0) return 0.4;
  const normalized = count / maxCount;
  return 0.4 + normalized * 0.6;
}

function countryFlag(code: string): string {
  if (code.length !== 2) return '';
  const offset = 0x1f1e6 - 65;
  return String.fromCodePoint(code.charCodeAt(0) + offset, code.charCodeAt(1) + offset);
}

export function WorldHeatmap({ initialData, range = '15m' }: WorldHeatmapProps) {
  const [data, setData] = useState<LiveData>(initialData);
  const [hoveredCountry, setHoveredCountry] = useState<CountryCount | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/analytics/live?range=${range}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastUpdated(new Date());
      }
    } catch {
      // Silently retry on next interval
    }
  }, [range]);

  useEffect(() => {
    const interval = setInterval(fetchLive, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchLive]);

  const countryMap = new Map(data.countries.map((c) => [c.country, c.count]));
  const maxCount = data.countries.length > 0 ? data.countries[0].count : 0;

  return (
    <div className={styles.root}>
      <div className={styles.mapContainer}>
        <svg
          viewBox={VIEWBOX}
          className={styles.map}
          role="img"
          aria-label="World heatmap showing active visitors by country"
        >
          {/* Background dots for all countries (faint) */}
          {COUNTRY_POSITIONS.map((pos) => {
            const count = countryMap.get(pos.id);
            if (count) return null; // Active countries rendered separately
            return (
              <circle
                key={pos.id}
                cx={pos.cx}
                cy={pos.cy}
                r={2}
                className={styles.dotInactive}
              />
            );
          })}

          {/* Active country dots (sized + colored by count) */}
          {data.countries.map((c) => {
            const pos = COUNTRY_POSITION_MAP[c.country];
            if (!pos) return null;
            const r = countToRadius(c.count, maxCount);
            const opacity = countToOpacity(c.count, maxCount);
            return (
              <g key={c.country}>
                {/* Glow ring */}
                <circle
                  cx={pos.cx}
                  cy={pos.cy}
                  r={r + 4}
                  className={styles.dotGlow}
                  style={{ opacity: opacity * 0.3 }}
                />
                {/* Main dot */}
                <circle
                  cx={pos.cx}
                  cy={pos.cy}
                  r={r}
                  className={styles.dotActive}
                  style={{ opacity }}
                  onMouseEnter={() => setHoveredCountry(c)}
                  onMouseLeave={() => setHoveredCountry(null)}
                />
              </g>
            );
          })}
        </svg>

        {hoveredCountry && (
          <div className={styles.tooltip}>
            <span className={styles.tooltipFlag}>
              {countryFlag(hoveredCountry.country)}
            </span>
            <span className={styles.tooltipName}>
              {COUNTRY_POSITION_MAP[hoveredCountry.country]?.name ?? hoveredCountry.country}
            </span>
            <span className={styles.tooltipCount}>
              {hoveredCountry.count.toLocaleString()} active
            </span>
          </div>
        )}
      </div>

      <div className={styles.sidebar}>
        <div className={styles.totalCard}>
          <span className={styles.totalLabel}>{RANGE_LABELS[range] ?? 'Active Now'}</span>
          <span className={styles.totalValue}>{data.totalActive.toLocaleString()}</span>
          <span className={styles.totalMeta}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        </div>

        <div className={styles.countryList}>
          <h3 className={styles.listTitle}>Top Countries</h3>
          {data.countries.length === 0 ? (
            <p className={styles.empty}>No active visitors</p>
          ) : (
            <ol className={styles.list}>
              {data.countries.slice(0, 20).map((c) => (
                <li key={c.country} className={styles.listItem}>
                  <span className={styles.listFlag}>{countryFlag(c.country)}</span>
                  <span className={styles.listName}>
                    {COUNTRY_POSITION_MAP[c.country]?.name ?? c.country}
                  </span>
                  <span className={styles.listCount}>{c.count.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
