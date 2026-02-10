import { Check } from 'lucide-react';
import styles from './PricingCard.module.css';

interface PricingCardProps {
  tier: 'free' | 'starter' | 'pro' | 'studio' | 'power';
  price: number;
  interval?: string;
  features: string[];
  isCurrentPlan?: boolean;
  isPopular?: boolean;
  badge?: string;
  onSelect: () => void;
  loading?: boolean;
}

const tierLabels: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  studio: 'Studio',
  power: 'Power',
};

export function PricingCard({
  tier,
  price,
  interval = '/mo',
  features,
  isCurrentPlan = false,
  isPopular = false,
  badge,
  onSelect,
  loading = false,
}: PricingCardProps) {
  const ctaLabel = isCurrentPlan ? 'Current Plan' : tier === 'free' ? 'Get Started' : 'Subscribe';
  const badgeText = badge || (isPopular ? 'Most Popular' : undefined);

  return (
    <div
      className={`${styles.card} ${isPopular ? styles.popular : ''} ${isCurrentPlan ? styles.current : ''}`}
    >
      {badgeText && <span className={styles.badge}>{badgeText}</span>}
      <div className={styles.header}>
        <h3 className={styles.tierName}>{tierLabels[tier]}</h3>
        <div className={styles.priceRow}>
          <span className={styles.currency}>$</span>
          <span className={styles.price}>{price}</span>
          {price > 0 && <span className={styles.interval}>{interval}</span>}
        </div>
      </div>
      <ul className={styles.features} role="list">
        {features.map((feature) => (
          <li key={feature} className={styles.featureItem}>
            <span className={styles.checkIcon} aria-hidden="true">
              <Check size={16} />
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button
        className={`${styles.cta} ${isCurrentPlan ? styles.ctaDisabled : styles.ctaActive}`}
        onClick={onSelect}
        disabled={isCurrentPlan || loading}
        aria-label={`${ctaLabel} - ${tierLabels[tier]} plan`}
      >
        {loading && <span className={styles.spinner} />}
        {ctaLabel}
      </button>
    </div>
  );
}
