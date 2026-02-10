'use client';

import { useState } from 'react';
import { PricingCard } from '@/components/pricing/PricingCard';
import styles from './page.module.css';

export function PricingClient() {
  const [loading, setLoading] = useState(false);

  const handleSelect = async (tier: 'free' | 'starter' | 'pro' | 'studio') => {
    if (tier === 'free') {
      window.location.href = '/create';
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subscription', tier }),
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
            '2 credits per month',
            'Up to 10 minutes each',
            '2 interactions per podcast',
            'Standard AI voices',
            'Public podcasts only',
            'Unlimited listening',
          ]}
          onSelect={() => handleSelect('free')}
        />
        <PricingCard
          tier="starter"
          price={9}
          features={[
            '5 credits per month',
            'Up to 10 minutes each',
            '5 interactions per podcast',
            '1 personal voice clone',
            'MP3 download',
            'Voice library access',
            '2 credit rollover',
          ]}
          onSelect={() => handleSelect('starter')}
          loading={loading}
        />
        <PricingCard
          tier="pro"
          price={24}
          isPopular
          features={[
            '15 credits per month',
            'Up to 10 minutes each',
            'Unlimited interactions',
            '3 personal voice clones',
            'Private & unlisted podcasts',
            'MP3 download + transcript PDF',
            'Analytics dashboard',
            '5 credit rollover',
          ]}
          onSelect={() => handleSelect('pro')}
          loading={loading}
        />
        <PricingCard
          tier="studio"
          price={49}
          features={[
            '50 credits per month',
            'Up to 10 minutes each',
            'Unlimited interactions',
            '10 personal voice clones',
            'Premium sound effects included',
            'Marketplace listing',
            'Full analytics + API access',
            '20 credit rollover',
          ]}
          onSelect={() => handleSelect('studio')}
          loading={loading}
        />
      </div>
    </section>
  );
}
