import styles from './charts.module.css';

export interface AreaPoint {
  /** The plotted value. */
  v: number;
  /** Optional x-axis tick label (rendered only when truthy). */
  m?: string | number;
}

interface AreaChartProps {
  data: AreaPoint[];
  /** Stable, unique gradient id — required when more than one chart shares a page. */
  id?: string;
  width?: number;
  height?: number;
  pad?: number;
  /** CSS color (defaults to the inherited --accent token). */
  accent?: string;
}

/**
 * Area + line trend, ported from the SottoDesign prototype. Pure SVG, no deps.
 * Stretches to its container width via preserveAspectRatio="none".
 */
export function AreaChart({
  data,
  id = 'areaGrad',
  width = 560,
  height = 150,
  pad = 8,
  accent = 'var(--accent)',
}: AreaChartProps) {
  if (data.length === 0) return null;

  const max = Math.max(...data.map((d) => d.v)) * 1.12 || 1;
  const min = 0;
  const x = (i: number) =>
    data.length === 1 ? width / 2 : pad + (i / (data.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / (max - min)) * (height - pad * 2 - 14);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.28" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.v)} r={i === data.length - 1 ? 4 : 2.5} fill={accent} />
          {d.m !== undefined && d.m !== '' && (
            <text x={x(i)} y={height - 1} textAnchor="middle" className={styles.chartX}>
              {d.m}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
