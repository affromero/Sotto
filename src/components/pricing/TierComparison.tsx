import { Check, X } from 'lucide-react';
import styles from './TierComparison.module.css';

interface TierComparisonProps {
  currentTier?: 'free' | 'pro' | 'team';
}

type CellValue = string | boolean;

interface ComparisonRow {
  label: string;
  free: CellValue;
  pro: CellValue;
  team: CellValue;
}

const rows: ComparisonRow[] = [
  { label: 'Podcasts / month', free: '3', pro: '20', team: 'Unlimited' },
  { label: 'Max duration', free: '10 min', pro: '30 min', team: '30 min' },
  { label: 'Interactions', free: '3 per podcast', pro: 'Unlimited', team: 'Unlimited' },
  { label: 'Private podcasts', free: false, pro: true, team: true },
  { label: 'Team features', free: false, pro: false, team: true },
  { label: 'Priority support', free: false, pro: true, team: true },
];

const tierLabels: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
};

const tiers = ['free', 'pro', 'team'] as const;

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
