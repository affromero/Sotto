import styles from './TimeSeriesChart.module.css';

interface DataPoint {
  date: string;
  value: number;
}

interface TimeSeriesChartProps {
  data: DataPoint[];
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function TimeSeriesChart({ data }: TimeSeriesChartProps) {
  if (data.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>No data for this period</div>
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={styles.root}>
      <div className={styles.chart} role="img" aria-label="Usage over time">
        {data.map((point) => (
          <div key={point.date} className={styles.barWrapper}>
            <div
              className={styles.bar}
              style={{ height: `${(point.value / maxValue) * 100}%` }}
              title={`${point.date}: ${point.value}`}
              role="meter"
              aria-valuenow={point.value}
              aria-valuemax={maxValue}
              aria-label={`${point.date}: ${point.value} requests`}
            />
            <span className={styles.barLabel}>{formatDateLabel(point.date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
