import styles from './BarChart.module.css';

interface BarChartItem {
  label: string;
  value: number;
}

interface BarChartProps {
  items: BarChartItem[];
  formatValue?: (value: number) => string;
}

export function BarChart({ items, formatValue = (v) => v.toFixed(2) }: BarChartProps) {
  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className={styles.root}>
      {items.map((item) => (
        <div key={item.label} className={styles.row}>
          <span className={styles.label}>{item.label}</span>
          <div className={styles.barContainer}>
            <div
              className={styles.bar}
              style={{ width: `${(item.value / maxValue) * 100}%` }}
              role="meter"
              aria-valuenow={item.value}
              aria-valuemax={maxValue}
              aria-label={`${item.label}: ${formatValue(item.value)}`}
            />
          </div>
          <span className={styles.value}>{formatValue(item.value)}</span>
        </div>
      ))}
    </div>
  );
}
