import styles from './charts.module.css';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** CSS color (defaults to the inherited --accent token). */
  accent?: string;
}

/** Axis-less mini trend line. Pure SVG, no deps. */
export function Sparkline({ data, width = 120, height = 32, accent = 'var(--accent)' }: SparklineProps) {
  if (data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const x = (i: number) => (data.length === 1 ? width / 2 : (i / (data.length - 1)) * width);
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="2.4" fill={accent} />
    </svg>
  );
}
