import { Check, X } from 'lucide-react';
import styles from './TierComparison.module.css';

interface TierComparisonProps {
  currentTier?: 'free' | 'pro' | 'creator';
}

type CellValue = string | boolean;

interface ComparisonRow {
  label: string;
  free: CellValue;
  pro: CellValue;
  creator: CellValue;
}

const rows: ComparisonRow[] = [
  { label: 'Podcasts / month', free: '2', pro: '15', creator: 'Unlimited' },
  { label: 'Max duration', free: '10 min', pro: '10 min', creator: '10 min' },
  { label: 'Interactions', free: '2 per podcast', pro: '10 per podcast', creator: 'Unlimited' },
  { label: 'Default TTS', free: 'Standard', pro: 'Standard', creator: 'Standard' },
  { label: 'Premium voice credits', free: '0', pro: '5 / month', creator: '20 / month' },
  { label: 'Personal voice clones', free: false, pro: '3', creator: '10' },
  { label: 'Voice library browse', free: false, pro: true, creator: true },
  { label: 'Marketplace listing', free: false, pro: false, creator: true },
  { label: 'Private podcasts', free: false, pro: true, creator: true },
  { label: 'MP3 download', free: false, pro: true, creator: true },
  { label: 'Transcript PDF', free: false, pro: true, creator: true },
  { label: 'Analytics', free: false, pro: false, creator: true },
];

const tierLabels: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  creator: 'Creator',
};

const tiers = ['free', 'pro', 'creator'] as const;

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
                  {currentTier === tier && (
                    <span className={styles.currentLabel}>Current</span>
                  )}
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
