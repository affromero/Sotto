'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Mic } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AudioConfigPanel, type AudioConfig } from '@/components/player/AudioConfigPanel';
import { StripeProvider } from '@/components/providers/StripeProvider';
import { VoicePaymentModal, type VoiceChargeItem } from '@/components/voices/VoicePaymentModal';
import styles from './VoiceRenditionForkModal.module.css';

interface VoiceRenditionForkModalProps {
  isOpen: boolean;
  onClose: () => void;
  podcastId: string;
  podcastTitle: string;
  speakers: string[];
}

type Step = 1 | 2;

export function VoiceRenditionForkModal({
  isOpen,
  onClose,
  podcastId,
  podcastTitle,
  speakers,
}: VoiceRenditionForkModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [audioConfig, setAudioConfig] = useState<AudioConfig | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [voiceCharges, setVoiceCharges] = useState<VoiceChargeItem[]>([]);

  const handleConfigChange = useCallback((config: AudioConfig) => {
    setAudioConfig(config);
  }, []);

  const handleNext = () => {
    if (!name.trim()) {
      setError('Please enter a name for your rendition');
      return;
    }
    setError(null);
    setStep(2);
  };

  const forkWithPayment = async (paymentIntentIds?: string[], skipPaidVoices?: boolean) => {
    if (!audioConfig) {
      setError('Please select a voice provider and assign voices');
      return;
    }

    const voices = audioConfig.voices
      .filter(v => v.voiceId)
      .map(v => ({ speaker: v.speaker, voiceId: v.voiceId! }));

    if (voices.length === 0) {
      setError('Please assign at least one voice');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/podcasts/${podcastId}/fork-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ttsProvider: audioConfig.ttsProvider,
          ttsModel: audioConfig.ttsModel,
          voices,
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
          router.push('/onboarding?step=keys');
          onClose();
          return;
        }
        throw new Error(data.error || 'Failed to create voice rendition');
      }

      const { id: forkId } = await response.json();
      router.push(`/podcast/${forkId}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
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
    setName('');
    setAudioConfig(null);
    setError(null);
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose} size="large">
        <div className={styles.modal}>
          <div className={styles.header}>
            <h2 className={styles.title}>Re-voice</h2>
            <p className={styles.subtitle}>
              Create a new voice rendition of &ldquo;{podcastTitle}&rdquo;
            </p>
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

          {step === 1 && (
            <div className={styles.stepContent}>
              <div className={styles.field}>
                <Input
                  label="Rendition Name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., British Narrator, Cinematic Style"
                  helperText="A short name to identify this voice rendition"
                />
              </div>

              <div className={styles.summaryBox}>
                <div className={styles.summaryRow}>
                  <Mic size={16} className={styles.summaryIcon} />
                  <span className={styles.summaryText}>
                    Same script, new voices &mdash; your rendition keeps the original
                    content and generates fresh audio with the voices you choose.
                  </span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className={styles.stepContent}>
              <AudioConfigPanel
                speakers={speakers}
                onConfigChange={handleConfigChange}
              />
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
                <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={loading}
                  onClick={handleSubmit}
                >
                  {loading ? 'Creating...' : 'Re-voice'}
                </Button>
              </>
            )}
          </div>
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
