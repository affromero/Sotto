'use client';

import { useMemo, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoDistance, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import landTopo from 'world-atlas/land-110m.json';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { TIMEZONE_PLACES } from './timezone-places';
import styles from './TimezoneGlobe.module.css';

interface Props {
  /** Selected IANA zone (may be absent from TIMEZONE_PLACES, e.g. an alias). */
  value: string;
  onChange: (tz: string) => void;
}

const SIZE = 340;
const TILT = -12;

const topology = landTopo as unknown as Topology<{ land: GeometryCollection }>;
const LAND = feature(topology, topology.objects.land) as unknown as FeatureCollection<Geometry>;
const GRATICULE = geoGraticule10();

/**
 * Rotatable globe timezone picker: every IANA zone's reference city is a dot,
 * so learners pick a place, not a UTC offset. Drag (or the arrow buttons) spins
 * the globe; the select below is the keyboard/screen-reader path and covers
 * zones that have no zone.tab coordinates.
 */
export function TimezoneGlobe({ value, onChange }: Props) {
  const initial = TIMEZONE_PLACES.find((p) => p.tz === value);
  const [lambda, setLambda] = useState(() => -(initial?.lon ?? 0));
  const dragRef = useRef<{ pointerId: number; x: number; lambda: number } | null>(null);

  const projection = useMemo(
    () =>
      geoOrthographic()
        .rotate([lambda, TILT])
        .translate([SIZE / 2, SIZE / 2])
        .scale(SIZE / 2 - 4)
        .clipAngle(90),
    [lambda]
  );
  const path = useMemo(() => geoPath(projection), [projection]);
  const center = useMemo(() => [-lambda, -TILT] as [number, number], [lambda]);

  const selected = TIMEZONE_PLACES.find((p) => p.tz === value);

  function spinTo(tz: string) {
    const place = TIMEZONE_PLACES.find((p) => p.tz === tz);
    if (place) setLambda(-place.lon);
    onChange(tz);
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, lambda };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setLambda(drag.lambda + (e.clientX - drag.x) * 0.45);
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.globeWrap}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={styles.globe}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="presentation"
          aria-hidden="true"
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 4} className={styles.ocean} />
          <path d={path(GRATICULE) ?? undefined} className={styles.graticule} />
          <path d={path(LAND) ?? undefined} className={styles.land} />
          {TIMEZONE_PLACES.filter((p) => geoDistance([p.lon, p.lat], center) < Math.PI / 2).map(
            (p) => {
              const [x, y] = projection([p.lon, p.lat]) ?? [0, 0];
              const isSelected = p.tz === value;
              return (
                <circle
                  key={p.tz}
                  cx={x}
                  cy={y}
                  r={isSelected ? 5 : 2.6}
                  className={isSelected ? styles.dotSelected : styles.dot}
                  onClick={() => spinTo(p.tz)}
                >
                  <title>{p.label}</title>
                </circle>
              );
            }
          )}
          {selected &&
            geoDistance([selected.lon, selected.lat], center) < Math.PI / 2 &&
            (() => {
              const [x, y] = projection([selected.lon, selected.lat]) ?? [0, 0];
              return (
                <text x={x} y={y - 10} className={styles.dotLabel} textAnchor="middle">
                  {selected.label}
                </text>
              );
            })()}
        </svg>
        <div className={styles.spinButtons}>
          <button
            type="button"
            className={styles.spin}
            aria-label="Rotate globe left"
            onClick={() => setLambda((l) => l + 30)}
          >
            ‹
          </button>
          <button
            type="button"
            className={styles.spin}
            aria-label="Rotate globe right"
            onClick={() => setLambda((l) => l - 30)}
          >
            ›
          </button>
        </div>
      </div>
      <label className={styles.selectLabel}>
        Your timezone
        <select
          className={styles.select}
          value={TIMEZONE_PLACES.some((p) => p.tz === value) ? value : ''}
          onChange={(e) => spinTo(e.target.value)}
        >
          {!TIMEZONE_PLACES.some((p) => p.tz === value) && (
            <option value="" disabled>
              {value}
            </option>
          )}
          {TIMEZONE_PLACES.map((p) => (
            <option key={p.tz} value={p.tz}>
              {p.tz.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
