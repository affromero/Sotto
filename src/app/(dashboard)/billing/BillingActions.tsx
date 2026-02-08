'use client';

import { useState } from 'react';
import { PricingCard } from '@/components/pricing/PricingCard';
import { Button } from '@/components/ui/Button';
import styles from './page.module.css';

interface BillingActionsProps {
  tier: string;
}

export function BillingActions({ tier }: BillingActionsProps) {
  const [loading, setLoading] = useState(false);

  const handleManageSubscription = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = async (selectedTier: 'free' | 'pro' | 'team') => {
    if (selectedTier === 'free') return;
    setLoading(true);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selectedTier }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setLoading(false);
    }
  };

  if (tier === 'FREE') {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Upgrade Your Plan</h2>
        <p className={styles.upgradeText}>
          Unlock more podcasts, longer episodes, and premium features.
        </p>
        <div className={styles.pricingGrid}>
          <PricingCard
            tier="free"
            price={0}
            features={[
              '3 podcasts/month',
              '10 min max',
              '3 interactions',
              'Public only',
            ]}
            isCurrentPlan
            onSelect={() => {}}
          />
          <PricingCard
            tier="pro"
            price={19}
            features={[
              '20 podcasts/month',
              '30 min max',
              'Unlimited interactions',
              'Private podcasts',
              'MP3 downloads',
            ]}
            isPopular
            onSelect={() => handleSelectPlan('pro')}
            loading={loading}
          />
          <PricingCard
            tier="team"
            price={49}
            features={[
              'Unlimited podcasts',
              '10 team seats',
              'Private team feed',
              'API access',
              'Analytics',
            ]}
            onSelect={() => handleSelectPlan('team')}
            loading={loading}
          />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Manage Subscription</h2>
      <p className={styles.manageText}>
        Update your payment method, change plans, or cancel your subscription through the Stripe customer portal.
      </p>
      <div className={styles.manageActions}>
        <Button onClick={handleManageSubscription} loading={loading}>
          Manage Subscription
        </Button>
      </div>
    </section>
  );
}
