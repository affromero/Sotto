import styles from './charts.module.css';

export interface DonutSegment {
  /** Magnitude of this segment (any unit; segments are normalized to the total). */
  gb: number;
  color: string;
  label?: string;
}

interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}

/** Ring chart for distributions (e.g. queue jobs by state). Pure SVG, no deps. */
export function Donut({
  segments,
  size = 140,
  thickness = 18,
  centerLabel,
  centerSub,
}: DonutProps) {
  const total = segments.reduce((a, s) => a + s.gb, 0) || 1;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  // Precompute each arc's dash + offset purely (no render-time mutation).
  const arcs = segments.map((s, i) => {
    const precedingGb = segments.slice(0, i).reduce((a, x) => a + x.gb, 0);
    return {
      color: s.color,
      dash: (s.gb / total) * circumference,
      offset: (precedingGb / total) * circumference,
    };
  });

  return (
    <div className={styles.donutWrap} style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={thickness}
            strokeDasharray={`${a.dash} ${circumference - a.dash}`}
            strokeDashoffset={-a.offset}
          />
        ))}
      </svg>
      {centerLabel && (
        <div className={styles.donutCenter}>
          <div className={styles.donutNum}>{centerLabel}</div>
          {centerSub && <div className={styles.donutSub}>{centerSub}</div>}
        </div>
      )}
    </div>
  );
}
