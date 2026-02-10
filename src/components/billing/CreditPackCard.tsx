'use client';

import { useState } from 'react';
import styles from './CreditPackCard.module.css';

interface CreditPackCardProps {
  credits: number;
  price: number;
  disabled?: boolean;
}

export function CreditPackCard({ credits, price, disabled = false }: CreditPackCardProps) {
  const [loading, setLoading] = useState(false);
  const perCredit = (price / credits).toFixed(2);

  const handlePurchase = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'credit_pack', credits }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.credits}>{credits}</div>
      <div className={styles.label}>credits</div>
      <div className={styles.price}>${price}</div>
      <div className={styles.perCredit}>${perCredit}/credit</div>
      <button
        className={styles.buyButton}
        onClick={handlePurchase}
        disabled={disabled || loading}
        aria-label={`Buy ${credits} credits for $${price}`}
      >
        {loading ? <span className={styles.spinner} /> : 'Buy'}
      </button>
    </div>
  );
}
