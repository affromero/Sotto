'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Shield } from 'lucide-react';
import { DiscoveryChat } from '@/components/discovery/DiscoveryChat';
import { InspireMe } from '@/components/discovery/InspireMe';
import { VerificationDetails } from '@/components/create/VerificationDetails';
import { VoicePicker, type VoiceSelection } from '@/components/discovery/VoicePicker';
import { TtsModelDropdown } from '@/components/create/TtsModelDropdown';
import { DurationSelector } from '@/components/create/DurationSelector';
import { FreeTierCounter } from '@/components/ui/FreeTierCounter';
import { GenerationProgress } from '@/components/create/GenerationProgress';
import { ScriptEditor } from '@/components/create/ScriptEditor';
import { ImportUploader } from '@/components/import/ImportUploader';
import { ImportProgress } from '@/components/import/ImportProgress';
import { StripeProvider } from '@/components/providers/StripeProvider';
import { VoicePaymentModal, type VoiceChargeItem } from '@/components/voices/VoicePaymentModal';
import { FREE_TIER_MAX_DURATION_MINUTES } from '@/lib/stripe';
import type { DiscoveryMetadata } from '@/types/discovery';
import styles from './page.module.css';

type Step = 'discovery' | 'voice' | 'scripting' | 'script-preview' | 'generating';
type TabMode = 'create' | 'import';
type ImportStep = 'upload' | 'importing';

interface ProviderQuota {
  provider: string;
  model: string;
  quota: number;
  used: number;
  remaining: number;
}

interface FreeTierInfo {
  used: number;
  limit: number;
  remaining: number;
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  ttsQuotas?: ProviderQuota[];
}

export interface DraftData {
  id: string;
  tabMode: 'create' | 'import';
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; chips: string[]; createdAt: string }>;
  metadata: {
    topic?: string;
    depth?: string;
    audienceLevel?: string;
    audience?: string;
    focusAreas?: string[];
    tone?: string;
    durationTarget?: number;
  } | null;
  draftData: Record<string, unknown> | null;
}

interface CreatePageClientProps {
  freeTier?: FreeTierInfo | null;
  isByokUser?: boolean;
  isProUser?: boolean;
  maxDurationMinutes?: number;
  maxSpeakers?: number;
  isAdmin?: boolean;
  draftData?: DraftData;
}

export function CreatePageClient({ freeTier, isByokUser, isProUser, maxDurationMinutes, maxSpeakers, isAdmin, draftData }: CreatePageClientProps) {
  return (
    <Suspense>
      <CreatePageContent freeTier={freeTier} isByokUser={isByokUser} isProUser={isProUser} maxDurationMinutes={maxDurationMinutes} maxSpeakers={maxSpeakers} isAdmin={isAdmin} draftData={draftData} />
    </Suspense>
  );
}

function CreatePageContent({ freeTier, isByokUser, isProUser, maxDurationMinutes: maxDurationProp, maxSpeakers, isAdmin, draftData }: CreatePageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createAsSotto = searchParams.get('as') === 'sotto';

  const [tabMode, setTabMode] = useState<TabMode>(draftData?.tabMode ?? 'create');
  const [step, setStep] = useState<Step>('discovery');
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [importingPodcastId, setImportingPodcastId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DiscoveryMetadata | null>(null);
  const [voiceSelection, setVoiceSelection] = useState<VoiceSelection>({});
  const [ttsProvider, setTtsProvider] = useState<string | undefined>(
    (draftData?.draftData?.ttsProvider as string) ?? undefined
  );
  const [aiModel, setAiModel] = useState<string | undefined>(
    (draftData?.draftData?.aiModel as string) ?? undefined
  );
  const [ttsModel, setTtsModel] = useState<string | undefined>(
    (draftData?.draftData?.ttsModel as string) ?? undefined
  );
  const maxDuration = maxDurationProp ?? FREE_TIER_MAX_DURATION_MINUTES;
  const [durationTarget, setDurationTarget] = useState(
    draftData?.metadata?.durationTarget ?? Math.min(10, maxDuration)
  );
  const [error, setError] = useState<string | null>(null);
  const [failedPodcastId, setFailedPodcastId] = useState<string | null>(null);
  const [inspireMeOpen, setInspireMeOpen] = useState(false);
  const [initialTopic, setInitialTopic] = useState<string | undefined>();
  const [podcastId, setPodcastId] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string>('PENDING');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [voiceCharges, setVoiceCharges] = useState<VoiceChargeItem[]>([]);
  const [draftId, setDraftId] = useState<string | null>(draftData?.id ?? null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleDraftCreated = useCallback((id: string) => {
    setDraftId(id);
  }, []);

  // Debounced save of voice/config to draft
  const saveDraftConfig = useCallback((id: string, data: Record<string, unknown>) => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      fetch(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftData: data }),
      }).catch((err) => console.warn('[sotto] draft config save failed', err));
    }, 2000);
  }, []);

  // Auto-save config changes when draftId is set
  useEffect(() => {
    if (!draftId) return;
    saveDraftConfig(draftId, { tabMode, ttsProvider, ttsModel, aiModel, durationTarget });
  }, [draftId, tabMode, ttsProvider, ttsModel, aiModel, durationTarget, saveDraftConfig]);

  const handleDiscoveryComplete = useCallback((meta: DiscoveryMetadata) => {
    setMetadata(meta);
    if (meta.durationTarget) {
      // Clamp to nearest valid step (5–max, step 5)
      const clamped = Math.max(5, Math.min(maxDuration, Math.round(meta.durationTarget / 5) * 5));
      setDurationTarget(clamped);
    }
    setStep('voice');
  }, [maxDuration]);

  const handleVoiceSelectionChange = useCallback((selection: VoiceSelection) => {
    setVoiceSelection(selection);
  }, []);

  const createPodcast = useCallback(async (paymentIntentIds?: string[]) => {
    if (!metadata) return;

    setStep('scripting');
    setError(null);
    setFailedPodcastId(null);

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
            metadata: { ...metadata, durationTarget, speakers: voiceSelection.speakers },
            voices: voiceSelection.voices,
            ttsProvider,
            ttsModel,
            aiModel,
            ...(paymentIntentIds ? { paymentIntentIds } : {}),
            ...(draftId ? { draftId } : {}),
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
  }, [metadata, voiceSelection, ttsProvider, ttsModel, aiModel, durationTarget, createAsSotto, draftId]);

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
          setError(data.failureReason || 'Script generation failed. Please try again.');
          setFailedPodcastId(podcastId);
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
          setError(data.failureReason || 'Audio generation failed. Please try again.');
          setFailedPodcastId(podcastId);
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

  const handleRetrySuggestion = useCallback((suggestion: string) => {
    setError(null);
    setFailedPodcastId(null);
    setStep('discovery');
    setInitialTopic(suggestion);
    setMetadata(null);
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
      return 'Tell Sotto what you want to learn, or paste any URL — articles, YouTube videos, and more.';
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
              {(freeTier || isProUser) && (
                <FreeTierCounter
                  used={freeTier?.used ?? 0}
                  limit={freeTier?.limit ?? 1}
                  dailyUsed={freeTier?.dailyUsed ?? 0}
                  dailyLimit={freeTier?.dailyLimit ?? 1}
                  isByokUser={isByokUser ?? false}
                  isProUser={isProUser ?? false}
                />
              )}
            </div>
            <p className={styles.subtitle}>{getSubtitle()}</p>
          </div>
        </header>

        {error && failedPodcastId && (
          <VerificationDetails
            podcastId={failedPodcastId}
            failureReason={error}
            onRetrySuggestion={handleRetrySuggestion}
          />
        )}

        {error && !failedPodcastId && (
          <div className={styles.error} role="alert">
            <div className={styles.errorContent}>
              <p>{error}</p>
              {isAdmin && podcastId && (
                <Link href={`/admin/podcasts?search=${podcastId}`} className={styles.adminLink}>
                  <Shield size={14} />
                  View in Admin Panel
                </Link>
              )}
            </div>
            <button
              className={styles.errorDismiss}
              onClick={() => { setError(null); setFailedPodcastId(null); }}
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
            <DiscoveryChat
              onComplete={handleDiscoveryComplete}
              initialTopic={initialTopic}
              aiModel={aiModel}
              onAiModelChange={setAiModel}
              isByokUser={isByokUser}
              initialDraftId={draftData?.id}
              initialMessages={draftData?.tabMode === 'create' ? draftData.messages : undefined}
              onDraftCreated={handleDraftCreated}
            />
          </div>
        )}

        {tabMode === 'import' && (
          <div className={styles.chatArea}>
            {importStep === 'upload' && (
              <ImportUploader
                onImportStarted={handleImportStarted}
                draftId={draftData?.tabMode === 'import' ? draftData.id : undefined}
                initialImportData={
                  draftData?.tabMode === 'import' && draftData.draftData?.importData
                    ? (draftData.draftData.importData as {
                        title?: string;
                        topic?: string;
                        sourcePlatform?: string;
                        isHumanContent?: boolean;
                        sttProvider?: string;
                      })
                    : undefined
                }
                onDraftCreated={handleDraftCreated}
              />
            )}
            {importStep === 'importing' && importingPodcastId && (
              <ImportProgress podcastId={importingPodcastId} isAdmin={isAdmin} />
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
            <VoicePicker onSelectionChange={handleVoiceSelectionChange} maxSpeakers={maxSpeakers} ttsProvider={ttsProvider} />
            <TtsModelDropdown
              ttsProvider={ttsProvider}
              ttsModel={ttsModel}
              onChange={(provider, model) => {
                setTtsProvider(provider);
                setTtsModel(model);
              }}
            />
            <DurationSelector value={durationTarget} onChange={setDurationTarget} max={maxDuration} />
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

        {(step === 'scripting' || step === 'generating') && (
          <div className={styles.chatArea}>
            <GenerationProgress status={pipelineStatus} topic={metadata?.topic} />
            <p className={styles.leaveNotice}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              You can safely leave this page — your podcast keeps generating in the background. Find it in your dashboard when it&apos;s ready.
            </p>
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
