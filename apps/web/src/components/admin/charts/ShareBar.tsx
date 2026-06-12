import styles from './charts.module.css';

export interface ShareRow {
  /** Fractional share (0–1); rows with share <= 0 are skipped. */
  share: number;
  color: string;
  name?: string;
}

interface ShareBarProps {
  rows: ShareRow[];
}

/** Horizontal stacked share bar (e.g. spend by provider). Pure CSS flex, no deps. */
export function ShareBar({ rows }: ShareBarProps) {
  const total = rows.reduce((a, r) => a + (r.share > 0 ? r.share : 0), 0) || 1;
  return (
    <div className={styles.sharebar} role="img" aria-hidden="true">
      {rows
        .filter((r) => r.share > 0)
        .map((r, i) => (
          <div
            key={i}
            className={styles.sharebarSeg}
            title={r.name}
            style={{ width: `${(r.share / total) * 100}%`, background: r.color }}
          />
        ))}
    </div>
  );
}
