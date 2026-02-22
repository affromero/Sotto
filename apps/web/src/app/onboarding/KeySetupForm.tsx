'use client';

import { useRouter } from 'next/navigation';
import type { AiProviderClientMeta } from '@/lib/providers/ai-registry';
import { AiProviderCards } from '@/components/settings/AiProviderCards';
import { TtsProviderCards } from '@/components/settings/TtsProviderCards';
import styles from './KeySetupForm.module.css';

interface ProviderStatus {
  provider: string;
  isValid: boolean;
}

interface KeySetupFormProps {
  initialAiConfigured: Array<ProviderStatus>;
  initialTtsConfigured: Array<ProviderStatus>;
  aiProviderMeta?: AiProviderClientMeta[];
}

export function KeySetupForm({ initialAiConfigured, initialTtsConfigured, aiProviderMeta = [] }: KeySetupFormProps) {
  const router = useRouter();

  const handleContinue = () => {
    router.push('/create');
  };

  const handleSkip = () => {
    router.push('/feed');
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.tip}>
        <svg
          className={styles.tipIcon}
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
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className={styles.tipText}>
          <span className={styles.tipHighlight}>AI is free for everyone</span>
          {' '}&mdash; add a voice provider key to remove the daily generation cap. BYOK gives you
          unlimited generation and model choice. Pro adds private podcasts, analytics, and more.
        </p>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>
            <h2 className={styles.sectionTitle}>AI Provider</h2>
            <span className={styles.sectionBadgeFree}>Free &mdash; included</span>
          </div>
          <p className={styles.sectionDescription}>
            AI is free for all users. Sotto handles script writing and Q&amp;A at no cost. Optionally
            add your own key for faster models.
          </p>
        </div>
        <AiProviderCards initialConfigured={initialAiConfigured} providerMeta={aiProviderMeta} />
      </section>

      <div className={styles.divider} role="separator" />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>
            <h2 className={styles.sectionTitle}>Text-to-Speech</h2>
            <span className={styles.sectionBadge}>Unlocks unlimited</span>
          </div>
          <p className={styles.sectionDescription}>
            Add a voice provider key for unlimited podcast generation with premium voices. Without
            one, you get a few free generations.
          </p>
        </div>
        <TtsProviderCards initialConfigured={initialTtsConfigured} />
      </section>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.continueButton}
          onClick={handleContinue}
        >
          Continue
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
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.skipLink}
          onClick={handleSkip}
        >
          Maybe later &mdash; explore the feed first
        </button>
      </div>
    </div>
  );
}
