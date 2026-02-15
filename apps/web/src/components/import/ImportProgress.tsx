'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Upload, FileAudio, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MetadataSuggestion } from './MetadataSuggestion';
import type { Podcast } from '@prisma/client';
import styles from './ImportProgress.module.css';

interface ImportProgressProps {
  podcastId: string;
}

type StepStatus = 'pending' | 'active' | 'complete' | 'error';

interface Step {
  id: string;
  label: string;
  icon: typeof Upload;
  status: StepStatus;
}

const statusToStepMap: Record<string, number> = {
  PENDING: 0,
  UPLOADING: 0,
  TRANSCRIBING: 1,
  PROCESSING: 2,
  READY: 3,
  FAILED: -1,
};

export function ImportProgress({ podcastId }: ImportProgressProps) {
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [suggestionHandled, setSuggestionHandled] = useState(false);

  const fetchPodcast = async () => {
    try {
      const response = await fetch(`/api/podcasts/${podcastId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch podcast status');
      }
      const data = await response.json();
      setPodcast(data);
      const stepIndex = statusToStepMap[data.status] ?? 0;
      setCurrentStep(stepIndex);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load podcast status');
      return null;
    }
  };

  useEffect(() => {
    let mounted = true;
    let intervalId: NodeJS.Timeout | null = null;

    const poll = async () => {
      const data = await fetchPodcast();
      if (!mounted) return;
      if (data?.status === 'READY' || data?.status === 'FAILED') {
        if (intervalId) clearInterval(intervalId);
      }
    };

    poll();
    intervalId = setInterval(poll, 3000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [podcastId]);

  const steps: Step[] = [
    {
      id: 'uploading',
      label: 'Uploading',
      icon: Upload,
      status:
        currentStep === -1
          ? 'error'
          : currentStep > 0
            ? 'complete'
            : currentStep === 0
              ? 'active'
              : 'pending',
    },
    {
      id: 'transcribing',
      label: 'Transcribing',
      icon: FileAudio,
      status:
        currentStep === -1
          ? 'error'
          : currentStep > 1
            ? 'complete'
            : currentStep === 1
              ? 'active'
              : 'pending',
    },
    {
      id: 'processing',
      label: 'Processing',
      icon: FileAudio,
      status:
        currentStep === -1
          ? 'error'
          : currentStep > 2
            ? 'complete'
            : currentStep === 2
              ? 'active'
              : 'pending',
    },
    {
      id: 'ready',
      label: 'Ready',
      icon: CheckCircle,
      status: currentStep === -1 ? 'error' : currentStep >= 3 ? 'complete' : 'pending',
    },
  ];

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorCard}>
          <XCircle size={48} className={styles.errorIcon} />
          <h3 className={styles.errorTitle}>Failed to Load Status</h3>
          <p className={styles.errorMessage}>{error}</p>
          <Button variant="primary" size="medium" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!podcast) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingCard}>
          <Loader2 size={48} className={styles.loadingSpinner} />
          <p className={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  const isFailed = podcast.status === 'FAILED';
  const isReady = podcast.status === 'READY';

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.title}>{isReady ? 'Import Complete!' : 'Importing Podcast'}</h2>
        <p className={styles.subtitle}>
          {isFailed
            ? 'Something went wrong during import'
            : isReady
              ? 'Your podcast is ready to listen'
              : 'Please wait while we process your audio file'}
        </p>

        <div className={styles.steps}>
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isLast = index === steps.length - 1;

            return (
              <div key={step.id} className={styles.stepWrapper}>
                <div className={styles.stepContent}>
                  <div
                    className={`${styles.stepIcon} ${styles[`stepIcon${step.status.charAt(0).toUpperCase() + step.status.slice(1)}`]}`}
                    aria-label={`${step.label} - ${step.status}`}
                  >
                    {step.status === 'active' ? (
                      <Loader2 size={24} className={styles.stepIconSpinner} />
                    ) : step.status === 'error' ? (
                      <XCircle size={24} />
                    ) : step.status === 'complete' ? (
                      <CheckCircle size={24} />
                    ) : (
                      <StepIcon size={24} />
                    )}
                  </div>
                  <div className={styles.stepLabel}>
                    <span
                      className={`${styles.stepLabelText} ${styles[`stepLabelText${step.status.charAt(0).toUpperCase() + step.status.slice(1)}`]}`}
                    >
                      {step.label}
                    </span>
                  </div>
                </div>
                {!isLast && (
                  <div
                    className={`${styles.stepConnector} ${step.status === 'complete' ? styles.stepConnectorComplete : ''}`}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>

        {isFailed && (
          <div className={styles.failedSection}>
            <p className={styles.failedMessage}>
              Import failed. Please try again or contact support if the problem persists.
            </p>
            <Button
              variant="primary"
              size="medium"
              onClick={() => (window.location.href = '/create')}
            >
              Start Over
            </Button>
          </div>
        )}

        {isReady && (podcast.suggestedTitle || podcast.suggestedTopic) && !suggestionHandled && (
          <MetadataSuggestion
            podcastId={podcastId}
            currentTitle={podcast.title}
            currentTopic={podcast.topic ?? ''}
            suggestedTitle={podcast.suggestedTitle}
            suggestedTopic={podcast.suggestedTopic}
            onAccepted={() => {
              setSuggestionHandled(true);
              fetchPodcast();
            }}
            onDismissed={() => setSuggestionHandled(true)}
          />
        )}

        {isReady && (
          <div className={styles.readySection}>
            <Link href={`/podcast/${podcastId}`} className={styles.listenLink}>
              <Button variant="primary" size="large" fullWidth>
                Listen Now
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
