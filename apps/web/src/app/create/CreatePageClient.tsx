'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DiscoveryChat } from '@/components/discovery/DiscoveryChat';
import { InspireMe } from '@/components/discovery/InspireMe';
import { VoicePicker, type VoiceSelection } from '@/components/discovery/VoicePicker';
import { TtsProviderSelector } from '@/components/create/TtsProviderSelector';
import { AiModelSelector } from '@/components/create/AiModelSelector';
import { DurationSelector } from '@/components/create/DurationSelector';
import { FreeTierCounter } from '@/components/ui/FreeTierCounter';
import { GenerationProgress } from '@/components/create/GenerationProgress';
import { ScriptEditor } from '@/components/create/ScriptEditor';
import { ImportUploader } from '@/components/import/ImportUploader';
import { ImportProgress } from '@/components/import/ImportProgress';
import { StripeProvider } from '@/components/providers/StripeProvider';
import { VoicePaymentModal, type VoiceChargeItem } from '@/components/voices/VoicePaymentModal';
import type { DiscoveryMetadata } from '@/types/discovery';
import styles from './page.module.css';

type Step = 'discovery' | 'voice' | 'scripting' | 'script-preview' | 'generating';
type TabMode = 'create' | 'import';
type ImportStep = 'upload' | 'importing';

interface FreeTierInfo {
  used: number;
  limit: number;
  remaining: number;
}

interface CreatePageClientProps {
  freeTier?: FreeTierInfo | null;
  isByokUser?: boolean;
}

export function CreatePageClient({ freeTier, isByokUser }: CreatePageClientProps) {
  return (
    <Suspense>
      <CreatePageContent freeTier={freeTier} isByokUser={isByokUser} />
    </Suspense>
  );
}

function CreatePageContent({ freeTier, isByokUser }: CreatePageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createAsSotto = searchParams.get('as') === 'sotto';

  const [tabMode, setTabMode] = useState<TabMode>('create');
  const [step, setStep] = useState<Step>('discovery');
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [importingPodcastId, setImportingPodcastId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DiscoveryMetadata | null>(null);
  const [voiceSelection, setVoiceSelection] = useState<VoiceSelection>({});
  const [ttsProvider, setTtsProvider] = useState<string | undefined>();
  const [aiModel, setAiModel] = useState<string | undefined>();
  const [durationTarget, setDurationTarget] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [inspireMeOpen, setInspireMeOpen] = useState(false);
  const [initialTopic, setInitialTopic] = useState<string | undefined>();
  const [podcastId, setPodcastId] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string>('PENDING');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [voiceCharges, setVoiceCharges] = useState<VoiceChargeItem[]>([]);

  // Auto-populate topic from URL query parameter (e.g., from Saved Ideas page)
  useEffect(() => {
    const topic = searchParams.get('topic');
    if (topic) {
      setInitialTopic(topic);
    }
  }, [searchParams]);

  const handleInspireTopic = useCallback((topic: string) => {
    setInitialTopic(topic);
  }, []);

  const handleDiscoveryComplete = useCallback((meta: DiscoveryMetadata) => {
    setMetadata(meta);
    if (meta.durationTarget) {
      // Clamp to nearest valid step (5–40, step 5)
      const clamped = Math.max(5, Math.min(40, Math.round(meta.durationTarget / 5) * 5));
      setDurationTarget(clamped);
    }
    setStep('voice');
  }, []);

  const handleVoiceSelectionChange = useCallback((selection: VoiceSelection) => {
    setVoiceSelection(selection);
  }, []);

  const createPodcast = useCallback(async (paymentIntentIds?: string[]) => {
    if (!metadata) return;

    setStep('scripting');
    setError(null);

    try {
      let response: Response;

      if (createAsSotto) {
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
            metadata: { ...metadata, durationTarget },
            hostVoiceId: voiceSelection.hostVoiceId,
            expertVoiceId: voiceSelection.expertVoiceId,
            ttsProvider,
            aiModel,
            ...(paymentIntentIds ? { paymentIntentIds } : {}),
          }),
        });
      }

      if (response.status === 402) {
        const data = await response.json();
        setVoiceCharges(data.voiceCharges);
        setPaymentModalOpen(true);
        setStep('voice');
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create podcast');
      }

      const data = await response.json();
      setPodcastId(data.id);
      setPipelineStatus(data.status || 'EXTRACTING');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('voice');
    }
  }, [metadata, voiceSelection, ttsProvider, aiModel, durationTarget, createAsSotto]);

  const handleGenerate = useCallback(async () => {
    await createPodcast();
  }, [createPodcast]);

  const handlePaymentComplete = useCallback(async (paymentIntentIds: string[]) => {
    setPaymentModalOpen(false);
    await createPodcast(paymentIntentIds);
  }, [createPodcast]);

  // Poll during scripting phase (waiting for SCRIPT_READY)
  const scriptingPollRef = useRef(false);
  useEffect(() => {
    if (step !== 'scripting' || !podcastId) return;
    scriptingPollRef.current = true;

    const interval = setInterval(async () => {
      if (!scriptingPollRef.current) return;
      try {
        const res = await fetch(`/api/podcasts/${podcastId}`);
        if (!res.ok) return;
        const data = await res.json();
        setPipelineStatus(data.status);

        if (data.status === 'SCRIPT_READY') {
          scriptingPollRef.current = false;
          setStep('script-preview');
        } else if (data.status === 'FAILED') {
          scriptingPollRef.current = false;
          setError('Script generation failed. Please try again.');
          setStep('voice');
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 3000);

    return () => {
      scriptingPollRef.current = false;
      clearInterval(interval);
    };
  }, [step, podcastId]);

  // Poll during generating phase (waiting for READY)
  const generatingPollRef = useRef(false);
  useEffect(() => {
    if (step !== 'generating' || !podcastId) return;
    generatingPollRef.current = true;

    const interval = setInterval(async () => {
      if (!generatingPollRef.current) return;
      try {
        const res = await fetch(`/api/podcasts/${podcastId}`);
        if (!res.ok) return;
        const data = await res.json();
        setPipelineStatus(data.status);

        if (data.status === 'READY') {
          generatingPollRef.current = false;
          router.push(`/podcast/${podcastId}`);
        } else if (data.status === 'FAILED') {
          generatingPollRef.current = false;
          setError('Audio generation failed. Please try again.');
          setStep('script-preview');
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 3000);

    return () => {
      generatingPollRef.current = false;
      clearInterval(interval);
    };
  }, [step, podcastId, router]);

  const handleScriptApprove = useCallback(() => {
    setStep('generating');
    setPipelineStatus('GENERATING_AUDIO');
  }, []);

  const handleScriptRegenerate = useCallback(() => {
    setStep('scripting');
    setPipelineStatus('SCRIPTING');
  }, []);

  const handleImportStarted = useCallback((id: string) => {
    setImportingPodcastId(id);
    setImportStep('importing');
  }, []);

  const handleTabChange = useCallback((mode: TabMode) => {
    setTabMode(mode);
    setError(null);
    if (mode === 'create') {
      setStep('discovery');
      setImportStep('upload');
      setImportingPodcastId(null);
    } else {
      setImportStep('upload');
    }
  }, []);

  const getTitle = () => {
    if (tabMode === 'import') {
      return importStep === 'importing' ? 'Importing Podcast' : 'Import a Podcast';
    }
    if (step === 'discovery') return 'Create a Podcast';
    if (step === 'voice') return 'Choose Voices';
    if (step === 'scripting') return 'Writing Your Script';
    if (step === 'script-preview') return 'Review Your Script';
    if (step === 'generating') return 'Generating Audio';
    return 'Create a Podcast';
  };

  const getSubtitle = () => {
    if (createAsSotto && tabMode === 'create') {
      return 'Creating as @sotto — this podcast will be owned by the official Sotto account.';
    }
    if (tabMode === 'import') {
      return importStep === 'importing'
        ? 'Your podcast is being processed'
        : 'Upload an existing audio file to share on Sotto';
    }
    if (step === 'discovery') {
      return 'Tell Sotto what you want to learn. We will craft a two-voice podcast just for you.';
    }
    if (step === 'voice') {
      return 'Pick voices for your Host and Expert, or use auto-assign.';
    }
    if (step === 'scripting') {
      return 'Crafting your podcast script...';
    }
    if (step === 'script-preview') {
      return 'Read through, make edits, then generate audio.';
    }
    if (step === 'generating') {
      return 'Creating audio from your approved script...';
    }
    return '';
  };

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
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{getTitle()}</h1>
              {freeTier && <FreeTierCounter used={freeTier.used} limit={freeTier.limit} />}
            </div>
            <p className={styles.subtitle}>{getSubtitle()}</p>
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

        {(step === 'discovery' || step === 'voice') && (
          <div className={styles.tabToggle} role="tablist">
            <button
              role="tab"
              aria-selected={tabMode === 'create'}
              className={`${styles.tabButton} ${tabMode === 'create' ? styles.tabButtonActive : ''}`}
              onClick={() => handleTabChange('create')}
              type="button"
            >
              Create
            </button>
            <button
              role="tab"
              aria-selected={tabMode === 'import'}
              className={`${styles.tabButton} ${tabMode === 'import' ? styles.tabButtonActive : ''}`}
              onClick={() => handleTabChange('import')}
              type="button"
            >
              Import
            </button>
          </div>
        )}

        {step === 'discovery' && tabMode === 'create' && (
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

        {tabMode === 'import' && (
          <div className={styles.chatArea}>
            {importStep === 'upload' && <ImportUploader onImportStarted={handleImportStarted} />}
            {importStep === 'importing' && importingPodcastId && (
              <ImportProgress podcastId={importingPodcastId} />
            )}
          </div>
        )}

        <InspireMe
          open={inspireMeOpen}
          onClose={() => setInspireMeOpen(false)}
          onSelectTopic={handleInspireTopic}
        />

        {step === 'voice' && tabMode === 'create' && (
          <div className={styles.chatArea}>
            <VoicePicker onSelectionChange={handleVoiceSelectionChange} />
            {isByokUser && <AiModelSelector value={aiModel} onChange={setAiModel} />}
            <TtsProviderSelector value={ttsProvider} onChange={setTtsProvider} />
            <DurationSelector value={durationTarget} onChange={setDurationTarget} />
            <div className={styles.voiceActions}>
              <button
                type="button"
                className={styles.backButton}
                onClick={() => setStep('discovery')}
              >
                Back
              </button>
              <button type="button" className={styles.generateButton} onClick={handleGenerate}>
                Generate Script
              </button>
            </div>
          </div>
        )}

        {step === 'scripting' && (
          <div className={styles.chatArea}>
            <GenerationProgress status={pipelineStatus} />
          </div>
        )}

        {step === 'script-preview' && podcastId && (
          <div className={styles.chatArea}>
            <ScriptEditor
              podcastId={podcastId}
              onApprove={handleScriptApprove}
              onRegenerate={handleScriptRegenerate}
            />
          </div>
        )}

        {step === 'generating' && (
          <div className={styles.chatArea}>
            <GenerationProgress status={pipelineStatus} />
          </div>
        )}
      </div>

      {paymentModalOpen && (
        <StripeProvider>
          <VoicePaymentModal
            isOpen={paymentModalOpen}
            onClose={() => setPaymentModalOpen(false)}
            voiceCharges={voiceCharges}
            onPaymentComplete={handlePaymentComplete}
          />
        </StripeProvider>
      )}
    </main>
  );
}
