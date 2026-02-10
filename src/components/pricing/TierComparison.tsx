import { Check, X } from 'lucide-react';
import styles from './TierComparison.module.css';

interface TierComparisonProps {
  currentTier?: 'free' | 'starter' | 'pro' | 'studio';
}

type CellValue = string | boolean;

interface ComparisonRow {
  label: string;
  free: CellValue;
  starter: CellValue;
  pro: CellValue;
  studio: CellValue;
}

const rows: ComparisonRow[] = [
  { label: 'Credits / month', free: '1', starter: '3', pro: '10', studio: '20' },
  { label: 'Rollover credits', free: '0', starter: '1', pro: '3', studio: '8' },
  { label: 'Max duration', free: '5 min', starter: '10 min', pro: '10 min', studio: '10 min' },
  {
    label: 'Interactions',
    free: '0.25 credits each',
    starter: '0.25 credits each',
    pro: '0.25 credits each',
    studio: '0.25 credits each',
  },
  { label: 'Personal voice clones', free: false, starter: '1', pro: '3', studio: '10' },
  {
    label: 'Sound effects',
    free: 'Standard',
    starter: 'Standard',
    pro: 'Standard',
    studio: 'Premium',
  },
  { label: 'Voice library browse', free: false, starter: true, pro: true, studio: true },
  { label: 'Marketplace listing', free: false, starter: false, pro: false, studio: true },
  { label: 'Private podcasts', free: false, starter: false, pro: true, studio: true },
  { label: 'MP3 download', free: false, starter: true, pro: true, studio: true },
  { label: 'Transcript PDF', free: false, starter: false, pro: true, studio: true },
  { label: 'Analytics', free: false, starter: false, pro: true, studio: true },
  { label: 'API access', free: false, starter: false, pro: false, studio: true },
];

const tierLabels: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  studio: 'Studio',
};

const tiers = ['free', 'starter', 'pro', 'studio'] as const;

function CellContent({ value }: { value: CellValue }) {
  if (typeof value === 'boolean') {
    return value ? (
      <span className={styles.iconIncluded} aria-label="Included">
        <Check size={18} />
      </span>
    ) : (
      <span className={styles.iconExcluded} aria-label="Not included">
        <X size={18} />
      </span>
    );
  }
  return <span>{value}</span>;
}

export function TierComparison({ currentTier }: TierComparisonProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.tableScroll}>
        <table className={styles.table} role="table">
          <thead>
            <tr>
              <th className={styles.featureHeader} scope="col">
                Feature
              </th>
              {tiers.map((tier) => (
                <th
                  key={tier}
                  className={`${styles.tierHeader} ${currentTier === tier ? styles.highlighted : ''}`}
                  scope="col"
                >
                  {tierLabels[tier]}
                  {currentTier === tier && <span className={styles.currentLabel}>Current</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={styles.row}>
                <td className={styles.featureCell}>{row.label}</td>
                {tiers.map((tier) => (
                  <td
                    key={tier}
                    className={`${styles.valueCell} ${currentTier === tier ? styles.highlighted : ''}`}
                  >
                    <CellContent value={row[tier]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
