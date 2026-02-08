'use client';

import { useState } from 'react';
import { PricingCard } from '@/components/pricing/PricingCard';
import styles from './page.module.css';

export function PricingClient() {
  const [loading, setLoading] = useState(false);

  const handleSelect = async (tier: 'free' | 'pro' | 'team') => {
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
        // Not authenticated, redirect to login
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
            '3 podcasts per month',
            'Up to 10 minutes each',
            '3 interactions per podcast',
            'Public podcasts only',
            'Community feed access',
            'Unlimited listening',
          ]}
          onSelect={() => handleSelect('free')}
        />
        <PricingCard
          tier="pro"
          price={19}
          isPopular
          features={[
            '20 podcasts per month',
            'Up to 30 minutes each',
            'Unlimited interactions',
            'Private & unlisted podcasts',
            'Download MP3s',
            'Priority support',
          ]}
          onSelect={() => handleSelect('pro')}
          loading={loading}
        />
        <PricingCard
          tier="team"
          price={49}
          features={[
            'Unlimited podcasts',
            'Up to 30 minutes each',
            'Unlimited interactions',
            'Private team feed',
            '10 team seats',
            'API access',
            'Analytics dashboard',
          ]}
          onSelect={() => handleSelect('team')}
          loading={loading}
        />
      </div>
    </section>
  );
}
