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

  const handleSelectPlan = async (selectedTier: 'starter' | 'pro' | 'studio') => {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subscription', tier: selectedTier }),
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
          Unlock more credits, premium voices, and creator features.
        </p>
        <div className={styles.pricingGrid}>
          <PricingCard
            tier="free"
            price={0}
            features={[
              '2 credits/month',
              '10 min max',
              '2 interactions',
              'Standard voices',
              'Public only',
            ]}
            isCurrentPlan
            onSelect={() => {}}
          />
          <PricingCard
            tier="starter"
            price={9}
            features={[
              '5 credits/month',
              '5 interactions',
              '1 voice clone',
              'MP3 download',
              '2 credit rollover',
            ]}
            onSelect={() => handleSelectPlan('starter')}
            loading={loading}
          />
          <PricingCard
            tier="pro"
            price={24}
            features={[
              '15 credits/month',
              'Unlimited interactions',
              '3 voice clones',
              'Private podcasts',
              'MP3 + PDF export',
            ]}
            isPopular
            onSelect={() => handleSelectPlan('pro')}
            loading={loading}
          />
          <PricingCard
            tier="studio"
            price={49}
            features={[
              '50 credits/month',
              'Unlimited interactions',
              '10 voice clones',
              'Premium SFX included',
              'Full analytics + API',
            ]}
            onSelect={() => handleSelectPlan('studio')}
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
        Update your payment method, change plans, or cancel your subscription through the Stripe
        customer portal.
      </p>
      <div className={styles.manageActions}>
        <Button onClick={handleManageSubscription} loading={loading}>
          Manage Subscription
        </Button>
      </div>
    </section>
  );
}
