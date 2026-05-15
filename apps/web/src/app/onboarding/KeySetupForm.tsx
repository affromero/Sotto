'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AiProviderClientMeta } from '@/lib/providers/ai-registry';
import type { TtsProviderClientMeta } from '@/lib/providers/tts-registry';
import type {
  SetupCapability,
  SetupCapabilityId,
  SetupReadiness,
} from '@/lib/setup-readiness';
import { AiProviderCards } from '@/components/settings/AiProviderCards';
import {
  PrivateRssFeedManager,
  type PrivateFeedTokenMetadata,
} from '@/components/settings/PrivateRssFeedManager';
import { TtsProviderCards } from '@/components/settings/TtsProviderCards';
import styles from './KeySetupForm.module.css';

interface ProviderStatus {
  provider: string;
  isValid: boolean;
}

interface KeySetupFormProps {
  setupReadiness: SetupReadiness;
  initialAiConfigured: Array<ProviderStatus>;
  initialTtsConfigured: Array<ProviderStatus>;
  initialPrivateFeedTokens: PrivateFeedTokenMetadata[];
  aiProviderMeta?: AiProviderClientMeta[];
  ttsProviderMeta?: TtsProviderClientMeta[];
}

function rebuildReadiness(capabilities: SetupCapability[]): SetupReadiness {
  const readyCount = capabilities.filter((capability) => capability.status === 'ready').length;
  return {
    ready: readyCount === capabilities.length,
    readyCount,
    totalCount: capabilities.length,
    nextAction: capabilities.find((capability) => capability.status === 'action_required') ?? null,
    capabilities,
  };
}

export function KeySetupForm({
  setupReadiness,
  initialAiConfigured,
  initialTtsConfigured,
  initialPrivateFeedTokens,
  aiProviderMeta = [],
  ttsProviderMeta = [],
}: KeySetupFormProps) {
  const router = useRouter();
  const [readiness, setReadiness] = useState(setupReadiness);
  const [submitting, setSubmitting] = useState(false);

  const updateCapability = (
    id: SetupCapabilityId,
    ready: boolean,
    readyDetail: string,
    actionDetail: string
  ) => {
    setReadiness((current) =>
      rebuildReadiness(
        current.capabilities.map((capability) =>
          capability.id === id
            ? {
                ...capability,
                status: ready ? 'ready' : 'action_required',
                detail: ready ? readyDetail : actionDetail,
              }
            : capability
        )
      )
    );
  };

  const completeOnboarding = async (nextPath: string) => {
    setSubmitting(true);
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
      router.push(nextPath);
    } catch {
      setSubmitting(false);
    }
  };

  const handleContinue = () => {
    completeOnboarding('/create');
  };

  const handleSkip = () => {
    completeOnboarding('/dashboard');
  };

  return (
    <div className={styles.wrapper}>
      <section className={styles.readinessPanel} aria-labelledby="setup-readiness-title">
        <div className={styles.readinessHeader}>
          <div>
            <span className={styles.kicker}>Workspace readiness</span>
            <h2 id="setup-readiness-title" className={styles.readinessTitle}>
              {readiness.ready
                ? 'Your private audio workspace is ready'
                : `${readiness.readyCount} of ${readiness.totalCount} setup checks ready`}
            </h2>
          </div>
          <span className={readiness.ready ? styles.readyBadge : styles.actionBadge}>
            {readiness.ready ? 'Ready' : 'Action needed'}
          </span>
        </div>

        <div className={styles.checkGrid}>
          {readiness.capabilities.map((capability) => (
            <div key={capability.id} className={styles.checkItem}>
              <span
                className={capability.status === 'ready' ? styles.checkReady : styles.checkNeeded}
                aria-hidden="true"
              >
                {capability.status === 'ready' ? 'OK' : '!'}
              </span>
              <div className={styles.checkBody}>
                <span className={styles.checkLabel}>{capability.label}</span>
                <span className={styles.checkDescription}>{capability.description}</span>
                <span className={styles.checkDetail}>{capability.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>
            <h2 className={styles.sectionTitle}>Generation Provider</h2>
            <span className={styles.sectionBadge}>Required for scripts</span>
          </div>
          <p className={styles.sectionDescription}>
            Select one explicit provider path. OpenAI is the shortest one-key path. Claude Code
            uses your local CLI when configured.
          </p>
        </div>
        <AiProviderCards
          initialConfigured={initialAiConfigured}
          providerMeta={aiProviderMeta}
          onReadyChange={(ready) =>
            updateCapability(
              'generation',
              ready,
              'Generation provider configured',
              'Add an AI key or choose a local agent.'
            )
          }
        />
      </section>

      <div className={styles.divider} role="separator" />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionLabel}>
            <h2 className={styles.sectionTitle}>Text-to-Speech</h2>
            <span className={styles.sectionBadge}>Required for audio</span>
          </div>
          <p className={styles.sectionDescription}>
            Add the voice provider you want Sotto to use. This is separate from the generation
            provider so costs and quality stay predictable.
          </p>
        </div>
        <TtsProviderCards
          initialConfigured={initialTtsConfigured}
          providerMeta={ttsProviderMeta}
          onReadyChange={(ready) =>
            updateCapability('tts', ready, 'Voice provider configured', 'Add a TTS provider key.')
          }
        />
      </section>

      <div className={styles.divider} role="separator" />

      <section className={styles.section}>
        <PrivateRssFeedManager
          initialTokens={initialPrivateFeedTokens}
          onTokenCountChange={(count) =>
            updateCapability(
              'private-rss',
              count > 0,
              `${count} private feed URL${count === 1 ? '' : 's'}`,
              'Create a private RSS token.'
            )
          }
        />
      </section>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.continueButton}
          onClick={handleContinue}
          disabled={submitting}
        >
          Continue to Create
        </button>
        <button type="button" className={styles.skipLink} onClick={handleSkip} disabled={submitting}>
          Continue to my workspace
        </button>
      </div>
    </div>
  );
}
