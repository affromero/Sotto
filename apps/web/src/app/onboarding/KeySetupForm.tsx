'use client';

import { useRouter } from 'next/navigation';
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
}

export function KeySetupForm({ initialAiConfigured, initialTtsConfigured }: KeySetupFormProps) {
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
          <span className={styles.tipHighlight}>One OpenAI key covers both AI and TTS</span>
          {' '}&mdash; add it once under AI Provider and once under Text-to-Speech, or use separate
          providers for each.
        </p>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>
            <h2 className={styles.sectionTitle}>AI Provider</h2>
            <span className={styles.sectionBadge}>Unlocks unlimited</span>
          </div>
          <p className={styles.sectionDescription}>
            Sotto uses an AI model to write podcast scripts and answer your questions. Connect your
            API key from Anthropic (Claude) or OpenAI.
          </p>
        </div>
        <AiProviderCards initialConfigured={initialAiConfigured} />
      </section>

      <div className={styles.divider} role="separator" />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>
            <h2 className={styles.sectionTitle}>Text-to-Speech</h2>
            <span className={styles.sectionBadge}>Unlocks unlimited</span>
          </div>
          <p className={styles.sectionDescription}>
            Sotto converts scripts into natural-sounding voices. Connect at least one TTS provider
            to hear your podcasts.
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
          Unlock Unlimited
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
