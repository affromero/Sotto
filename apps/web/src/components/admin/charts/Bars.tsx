import styles from './charts.module.css';

export interface BarRow {
  label: string;
  v: number;
  color?: string;
}

interface BarsProps {
  rows: BarRow[];
  /** Value formatter for the trailing readout (e.g. USD). */
  fmt?: (v: number) => string;
}

/** Labelled horizontal bar set (e.g. cost by learner / category). Pure CSS, no deps. */
export function Bars({ rows, fmt = (v) => String(v) }: BarsProps) {
  const max = Math.max(...rows.map((r) => r.v), 0) || 1;
  return (
    <div className={styles.bars}>
      {rows.map((r, i) => (
        <div key={i} className={styles.barsRow}>
          <div className={styles.barsLabel} title={r.label}>
            {r.label}
          </div>
          <div className={styles.barsTrack}>
            <div
              className={styles.barsFill}
              style={{ width: `${(r.v / max) * 100}%`, background: r.color ?? 'var(--accent)' }}
            />
          </div>
          <div className={styles.barsVal}>{fmt(r.v)}</div>
        </div>
      ))}
    </div>
  );
}
