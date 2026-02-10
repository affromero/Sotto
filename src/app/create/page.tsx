'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DiscoveryChat } from '@/components/discovery/DiscoveryChat';
import { InspireMe } from '@/components/discovery/InspireMe';
import { VoicePicker, type VoiceSelection } from '@/components/discovery/VoicePicker';
import type { DiscoveryMetadata } from '@/types/discovery';
import styles from './page.module.css';

type Step = 'discovery' | 'voice' | 'generating';

export default function CreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createAsSotto = searchParams.get('as') === 'sotto';
  const [step, setStep] = useState<Step>('discovery');
  const [metadata, setMetadata] = useState<DiscoveryMetadata | null>(null);
  const [voiceSelection, setVoiceSelection] = useState<VoiceSelection>({
    usePremiumVoice: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [inspireMeOpen, setInspireMeOpen] = useState(false);
  const [initialTopic, setInitialTopic] = useState<string | undefined>();

  const handleInspireTopic = useCallback((topic: string) => {
    setInitialTopic(topic);
  }, []);

  const handleDiscoveryComplete = useCallback((meta: DiscoveryMetadata) => {
    setMetadata(meta);
    setStep('voice');
  }, []);

  const handleVoiceSelectionChange = useCallback((selection: VoiceSelection) => {
    setVoiceSelection(selection);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!metadata) return;

    setStep('generating');
    setError(null);

    try {
      let response: Response;

      if (createAsSotto) {
        // Admin creating as @sotto system account
        response = await fetch('/api/admin/podcasts/create-as-sotto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: metadata.topic,
            topic: metadata.topic,
          }),
        });
      } else {
        response = await fetch('/api/podcasts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: metadata.topic,
            topic: metadata.topic,
            metadata,
            hostVoiceId: voiceSelection.hostVoiceId,
            expertVoiceId: voiceSelection.expertVoiceId,
            usePremiumVoice: voiceSelection.usePremiumVoice,
          }),
        });
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create podcast');
      }

      const podcast = await response.json();
      router.push(`/podcast/${podcast.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('voice');
    }
  }, [metadata, voiceSelection, router, createAsSotto]);

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <a href="/dashboard" className={styles.backLink} aria-label="Back to dashboard">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </a>
          <div className={styles.headerText}>
            <h1 className={styles.title}>
              {step === 'discovery' && 'Create a Podcast'}
              {step === 'voice' && 'Choose Voices'}
              {step === 'generating' && 'Creating Your Podcast'}
            </h1>
            <p className={styles.subtitle}>
              {createAsSotto
                ? 'Creating as @sotto — this podcast will be owned by the official Sotto account.'
                : step === 'discovery'
                  ? 'Tell Sotto what you want to learn. We will craft a two-voice podcast just for you.'
                  : step === 'voice'
                    ? 'Pick voices for your Host and Expert, or use auto-assign.'
                    : 'Hang tight while we generate your podcast.'}
            </p>
          </div>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            <p>{error}</p>
            <button
              className={styles.errorDismiss}
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {step === 'generating' && (
          <div className={styles.generatingOverlay} role="status">
            <div className={styles.generatingContent}>
              <div className={styles.spinner} aria-hidden="true" />
              <p className={styles.generatingText}>Creating your podcast...</p>
              <p className={styles.generatingHint}>This may take a few moments</p>
            </div>
          </div>
        )}

        {step === 'discovery' && (
          <div className={styles.chatArea}>
            <div className={styles.inspireRow}>
              <button
                type="button"
                className={styles.inspireMeButton}
                onClick={() => setInspireMeOpen(true)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3l1.6 5.1H19l-4.2 3 1.6 5.1L12 13.2l-4.4 3 1.6-5.1-4.2-3h5.4z" />
                </svg>
                Inspire Me
              </button>
            </div>
            <DiscoveryChat onComplete={handleDiscoveryComplete} initialTopic={initialTopic} />
          </div>
        )}

        <InspireMe
          open={inspireMeOpen}
          onClose={() => setInspireMeOpen(false)}
          onSelectTopic={handleInspireTopic}
        />

        {step === 'voice' && (
          <div className={styles.chatArea}>
            <VoicePicker onSelectionChange={handleVoiceSelectionChange} />
            <div className={styles.voiceActions}>
              <button
                type="button"
                className={styles.backButton}
                onClick={() => setStep('discovery')}
              >
                Back
              </button>
              <button type="button" className={styles.generateButton} onClick={handleGenerate}>
                Generate Podcast
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
