'use client';

import { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import styles from './VoicePaymentModal.module.css';

export interface VoiceChargeItem {
  voiceCloneId: string;
  name: string;
  priceInCents: number;
  ownerName: string | null;
  platformFeeCents: number;
}

interface VoicePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  voiceCharges: VoiceChargeItem[];
  onPaymentComplete: (paymentIntentIds: string[]) => void;
  /** When true, show "Use free voices instead" option for alternate voice tracks. */
  allowSkip?: boolean;
  onSkip?: () => void;
}

function PaymentForm({
  voiceCharges,
  onPaymentComplete,
  onClose,
  allowSkip,
  onSkip,
}: Omit<VoicePaymentModalProps, 'isOpen'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCents = voiceCharges.reduce((sum, c) => sum + c.priceInCents, 0);
  const totalFeeCents = voiceCharges.reduce((sum, c) => sum + c.platformFeeCents, 0);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    try {
      // 1. Create PaymentIntents on the server
      const res = await fetch('/api/stripe/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceCharges: voiceCharges.map((c) => ({ voiceCloneId: c.voiceCloneId })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create payment');
      }

      const { payments } = await res.json() as {
        payments: Array<{ voiceCloneId: string; clientSecret: string; paymentIntentId: string }>;
      };

      // 2. Confirm each PaymentIntent with the card
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      const paymentIntentIds: string[] = [];

      for (const payment of payments) {
        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
          payment.clientSecret,
          { payment_method: { card: cardElement } }
        );

        if (confirmError) {
          throw new Error(confirmError.message || 'Payment failed');
        }

        if (paymentIntent) {
          paymentIntentIds.push(payment.paymentIntentId);
        }
      }

      onPaymentComplete(paymentIntentIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.content}>
      <p className={styles.description}>
        This podcast uses premium voices. Complete payment to proceed.
      </p>

      <div className={styles.lineItems}>
        {voiceCharges.map((charge) => (
          <div key={charge.voiceCloneId} className={styles.lineItem}>
            <div className={styles.voiceInfo}>
              <span className={styles.voiceName}>{charge.name}</span>
              <span className={styles.voiceOwner}>by {charge.ownerName || 'Unknown'}</span>
            </div>
            <span className={styles.voicePrice}>
              ${(charge.priceInCents / 100).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>Voice fees</span>
          <span>${((totalCents - totalFeeCents) / 100).toFixed(2)}</span>
        </div>
        <div className={styles.totalRow}>
          <span>Platform fee</span>
          <span>${(totalFeeCents / 100).toFixed(2)}</span>
        </div>
        <div className={styles.totalRowFinal}>
          <span>Total</span>
          <span>${(totalCents / 100).toFixed(2)}</span>
        </div>
      </div>

      <div className={styles.cardSection}>
        <span className={styles.cardLabel}>Card details</span>
        <div className={styles.cardElement}>
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  color: '#1E2128',
                  '::placeholder': { color: '#9CA3AF' },
                },
              },
            }}
          />
        </div>
      </div>

      <div className={styles.reassurance}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span>You will only be charged if generation succeeds</span>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          loading={loading}
          disabled={!stripe}
        >
          {loading ? 'Processing...' : `Pay $${(totalCents / 100).toFixed(2)} & Generate`}
        </Button>
      </div>

      {allowSkip && onSkip && (
        <div className={styles.skipOption}>
          <button type="button" className={styles.skipButton} onClick={onSkip}>
            Use free voices instead
          </button>
        </div>
      )}
    </div>
  );
}

export function VoicePaymentModal({
  isOpen,
  onClose,
  voiceCharges,
  onPaymentComplete,
  allowSkip,
  onSkip,
}: VoicePaymentModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Voice Payment" size="medium">
      <PaymentForm
        voiceCharges={voiceCharges}
        onPaymentComplete={onPaymentComplete}
        onClose={onClose}
        allowSkip={allowSkip}
        onSkip={onSkip}
      />
    </Modal>
  );
}
