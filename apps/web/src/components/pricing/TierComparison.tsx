import { Check, X } from 'lucide-react';
import styles from './TierComparison.module.css';

interface TierComparisonProps {
  currentTier?: 'free' | 'starter' | 'pro' | 'studio' | 'power';
}

type CellValue = string | boolean;

interface ComparisonRow {
  label: string;
  free: CellValue;
  starter: CellValue;
  pro: CellValue;
  studio: CellValue;
  power: CellValue;
}

const rows: ComparisonRow[] = [
  {
    label: 'Price',
    free: '$0',
    starter: '$14/mo',
    pro: '$34/mo',
    studio: '$69/mo',
    power: '$9/mo',
  },
  { label: 'Credits / month', free: '3', starter: '5', pro: '10', studio: '20', power: '50' },
  { label: 'Rollover credits', free: '0', starter: '1', pro: '3', studio: '8', power: '10' },
  {
    label: 'Max duration',
    free: '5 min',
    starter: '10 min',
    pro: '10 min',
    studio: '10 min',
    power: '10 min',
  },
  {
    label: 'Interactions',
    free: '0.25 credits each',
    starter: '0.25 credits each',
    pro: '0.25 credits each',
    studio: '0.25 credits each',
    power: '0.25 credits each',
  },
  {
    label: 'Personal voice clones',
    free: false,
    starter: '1',
    pro: '3',
    studio: '10',
    power: '10',
  },
  {
    label: 'Sound effects',
    free: 'Standard',
    starter: 'Standard',
    pro: 'Standard',
    studio: 'Premium',
    power: 'Premium',
  },
  {
    label: 'Voice library browse',
    free: false,
    starter: true,
    pro: true,
    studio: true,
    power: true,
  },
  {
    label: 'Marketplace listing',
    free: false,
    starter: false,
    pro: false,
    studio: true,
    power: true,
  },
  { label: 'Private podcasts', free: false, starter: false, pro: true, studio: true, power: true },
  { label: 'MP3 download', free: false, starter: true, pro: true, studio: true, power: true },
  { label: 'Transcript PDF', free: false, starter: false, pro: true, studio: true, power: true },
  { label: 'Analytics', free: false, starter: false, pro: true, studio: true, power: true },
  { label: 'API access', free: false, starter: false, pro: false, studio: true, power: false },
  {
    label: 'Requires own API key',
    free: false,
    starter: false,
    pro: false,
    studio: false,
    power: true,
  },
];

const tierLabels: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  studio: 'Studio',
  power: 'Power',
};

const tiers = ['free', 'starter', 'pro', 'studio', 'power'] as const;

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
