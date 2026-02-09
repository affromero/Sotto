'use client';

import { useState } from 'react';
import { PricingCard } from '@/components/pricing/PricingCard';
import styles from './page.module.css';

export function PricingClient() {
  const [loading, setLoading] = useState(false);

  const handleSelect = async (tier: 'free' | 'pro' | 'creator') => {
    if (tier === 'free') {
      window.location.href = '/create';
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        window.location.href = '/auth/login';
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.pricingSection}>
      <div className={styles.pricingGrid}>
        <PricingCard
          tier="free"
          price={0}
          features={[
            '2 podcasts per month',
            'Up to 10 minutes each',
            '2 interactions per podcast',
            'Standard AI voices',
            'Public podcasts only',
            'Unlimited listening',
          ]}
          onSelect={() => handleSelect('free')}
        />
        <PricingCard
          tier="pro"
          price={14}
          isPopular
          features={[
            '8 podcasts per month',
            'Up to 10 minutes each',
            '10 interactions per podcast',
            '3 premium voice credits/mo',
            'Clone up to 2 personal voices',
            'Private & unlisted podcasts',
            'MP3 download + transcript PDF',
            'Voice library access',
          ]}
          onSelect={() => handleSelect('pro')}
          loading={loading}
        />
        <PricingCard
          tier="creator"
          price={29}
          features={[
            '30 podcasts per month',
            'Up to 10 minutes each',
            'Unlimited interactions',
            '10 premium voice credits/mo',
            'Clone up to 5 personal voices',
            'Premium sound effects',
            'MP3 download + transcript PDF',
            'Voice marketplace + analytics',
          ]}
          onSelect={() => handleSelect('creator')}
          loading={loading}
        />
      </div>
    </section>
  );
}
