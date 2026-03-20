'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StripeProvider } from '@/components/providers/StripeProvider';
import { VoicePaymentModal, type VoiceChargeItem } from '@/components/voices/VoicePaymentModal';
import styles from './ForkRemixModal.module.css';

interface ForkRemixModalProps {
  isOpen: boolean;
  onClose: () => void;
  podcastId: string;
  podcastTitle: string;
}

type Step = 1 | 2;

export function ForkRemixModal({ isOpen, onClose, podcastId, podcastTitle }: ForkRemixModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [voiceCharges, setVoiceCharges] = useState<VoiceChargeItem[]>([]);

  const [formData, setFormData] = useState({
    topic: podcastTitle,
    remixNote: '',
    focusAreas: '',
    depth: '',
    tone: '',
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    }
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
    }
  };

  const forkWithPayment = async (paymentIntentIds?: string[], skipPaidVoices?: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: formData.topic || undefined,
          remixNote: formData.remixNote || undefined,
          focusAreas: formData.focusAreas || undefined,
          depth: formData.depth || undefined,
          tone: formData.tone || undefined,
          ...(paymentIntentIds ? { paymentIntentIds } : {}),
          ...(skipPaidVoices ? { skipPaidVoices: true } : {}),
        }),
      });

      if (response.status === 402) {
        const data = await response.json();
        setVoiceCharges(data.voiceCharges);
        setPaymentModalOpen(true);
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        if (data.code === 'daily_limit_reached') {
          router.push('/billing');
          onClose();
          return;
        }
        throw new Error(data.error || 'Failed to fork podcast');
      }

      const { id: newPodcastId } = await response.json();
      router.push(`/podcast/${newPodcastId}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await forkWithPayment();
  };

  const handlePaymentComplete = async (paymentIntentIds: string[]) => {
    setPaymentModalOpen(false);
    await forkWithPayment(paymentIntentIds);
  };

  const handleSkipPaidVoices = async () => {
    setPaymentModalOpen(false);
    await forkWithPayment(undefined, true);
  };

  const handleClose = () => {
    setStep(1);
    setFormData({
      topic: podcastTitle,
      remixNote: '',
      focusAreas: '',
      depth: '',
      tone: '',
    });
    setError(null);
    onClose();
  };

  return (
    <>
    <Modal isOpen={isOpen} onClose={handleClose} size="large">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Fork & Remix</h2>
          <p className={styles.subtitle}>Create your own version of this podcast</p>
        </div>

        <div className={styles.stepIndicator}>
          <div className={`${styles.stepDot} ${step >= 1 ? styles.stepActive : ''}`}>
            <span>1</span>
          </div>
          <div className={styles.stepLine} />
          <div className={`${styles.stepDot} ${step >= 2 ? styles.stepActive : ''}`}>
            <span>2</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {step === 1 && (
            <div className={styles.stepContent}>
              <div className={styles.field}>
                <Input
                  label="Topic"
                  name="topic"
                  value={formData.topic}
                  onChange={handleInputChange}
                  placeholder="Enter your topic"
                  helperText="Customize the topic or keep the original"
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="remixNote" className={styles.label}>
                  Remix Note
                </label>
                <textarea
                  id="remixNote"
                  name="remixNote"
                  value={formData.remixNote}
                  onChange={handleInputChange}
                  placeholder="Describe what you're changing or adding..."
                  className={styles.textarea}
                  rows={3}
                />
                <span className={styles.helperText}>
                  Explain your creative direction (optional)
                </span>
              </div>

              <div className={styles.field}>
                <Input
                  label="Focus Areas"
                  name="focusAreas"
                  value={formData.focusAreas}
                  onChange={handleInputChange}
                  placeholder="e.g., technical details, historical context"
                  helperText="What aspects should this version emphasize?"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className={styles.stepContent}>
              <div className={styles.confirmSection}>
                <div className={styles.confirmIcon}>
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
                  </svg>
                </div>
                <h3 className={styles.confirmTitle}>Ready to Fork?</h3>
                <p className={styles.confirmText}>
                  Your new podcast will be queued for generation.
                </p>

                <div className={styles.summaryBox}>
                  <div className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>Topic:</span>
                    <span className={styles.summaryValue}>{formData.topic}</span>
                  </div>
                  {formData.remixNote && (
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>Remix Note:</span>
                      <span className={styles.summaryValue}>{formData.remixNote}</span>
                    </div>
                  )}
                  {formData.focusAreas && (
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>Focus:</span>
                      <span className={styles.summaryValue}>{formData.focusAreas}</span>
                    </div>
                  )}
                </div>

                <div className={styles.field}>
                  <Input
                    label="Depth (Optional)"
                    name="depth"
                    value={formData.depth}
                    onChange={handleInputChange}
                    placeholder="e.g., beginner, intermediate, expert"
                    helperText="Adjust the complexity level"
                  />
                </div>

                <div className={styles.field}>
                  <Input
                    label="Tone (Optional)"
                    name="tone"
                    value={formData.tone}
                    onChange={handleInputChange}
                    placeholder="e.g., casual, formal, conversational"
                    helperText="Set the podcast tone"
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <div className={styles.actions}>
            {step === 1 && (
              <>
                <Button type="button" variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" onClick={handleNext}>
                  Next
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button type="button" variant="ghost" onClick={handleBack}>
                  Back
                </Button>
                <Button type="submit" variant="primary" loading={loading}>
                  {loading ? 'Forking...' : 'Fork Podcast'}
                </Button>
              </>
            )}
          </div>
        </form>
      </div>
    </Modal>

    {paymentModalOpen && (
      <StripeProvider>
        <VoicePaymentModal
          isOpen={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          voiceCharges={voiceCharges}
          onPaymentComplete={handlePaymentComplete}
          allowSkip
          onSkip={handleSkipPaidVoices}
        />
      </StripeProvider>
    )}
    </>
  );
}
