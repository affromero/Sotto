'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { AvatarPanel } from './AvatarPanel';
import { PreviewPanel } from './PreviewPanel';
import { ScriptReviewPanel } from './ScriptReviewPanel';
import { VisualPipelinePanel } from './VisualPipelinePanel';
import styles from './ShowcaseBuilder.module.css';

interface ProviderModel {
  id: string;
  displayName: string;
}

interface ProviderInfo {
  id: string;
  displayName: string;
  qualityTier: string;
  defaultModel: string;
  models: ProviderModel[];
}

interface PodcastOption {
  id: string;
  title: string;
  status: string;
  ttsProvider: string | null;
  aiModel: string | null;
  segmentCount: number;
  updatedAt: string;
}

interface AiModelOption {
  id: string;
  displayName: string;
  tier: string;
  group: string;
  hint?: string;
}

interface SegmentData {
  id: string;
  order: number;
  speaker: string;
  text: string;
  audioUrl: string | null;
  duration: number | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  ttsVoiceId: string | null;
}

interface CatalogVoice {
  id: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  description?: string;
}

interface Boundary {
  afterSegmentId: string;
  beforeSegmentId: string;
  afterOrder: number;
  beforeOrder: number;
  fromProvider: string | null;
  toProvider: string | null;
}

type Status = 'idle' | 'loading' | 'saving' | 'generating' | 'creating' | 'success' | 'error';

const PROVIDER_COLORS: Record<string, string> = {
  elevenlabs: '#6366f1',
  openai: '#10a37f',
  cartesia: '#e11d48',
  hume: '#f59e0b',
  fal: '#8b5cf6',
  replicate: '#3b82f6',
  minimax: '#ec4899',
  kittentts: '#6b7280',
};

const FEATURE_OPTIONS = [
  { slug: 'creation-flow', label: 'Creation Flow' },
  { slug: 'interrupt', label: 'Interrupt & Q&A' },
  { slug: 'fork', label: 'Fork & Remix' },
  { slug: 'voice-comparison', label: 'Voice Comparison' },
  { slug: 'import', label: 'Import Podcasts' },
  { slug: 'social-feed', label: 'Social Feed' },
  { slug: 'byok', label: 'Bring Your Own Keys' },
  { slug: 'voice-cloning', label: 'Voice Cloning' },
  { slug: 'script-review', label: 'Script Review' },
  { slug: 'video-generation', label: 'Video Generation' },
  { slug: 'collections', label: 'Collections' },
  { slug: 'multi-speaker', label: 'Multi-Speaker' },
];

/** Statuses that indicate in-progress generation */
const IN_PROGRESS_STATUSES = ['SCRIPTING', 'VERIFYING_SCRIPT', 'VALIDATING_REFERENCES', 'GENERATING_AUDIO', 'STITCHING'];

/** Video generation statuses */
const VIDEO_IN_PROGRESS_STATUSES = ['PENDING', 'CLASSIFYING', 'GENERATING_VISUALS', 'GENERATING_TRANSITIONS', 'GENERATING_AVATARS', 'COMPOSING'];

/** Pipeline stages for progress display */
const PIPELINE_STAGES = [
  { key: 'script', label: 'Script' },
  { key: 'audio', label: 'Audio' },
  { key: 'visuals', label: 'Visuals' },
  { key: 'transitions', label: 'Transitions' },
  { key: 'avatars', label: 'Avatars' },
  { key: 'composing', label: 'Composing' },
  { key: 'ready', label: 'Ready' },
] as const;

/** Map podcast + video status to the active pipeline stage */
function getActiveStage(podcastStatus: string, videoStatus: string | null): string {
  if (['SCRIPTING', 'VERIFYING_SCRIPT', 'VALIDATING_REFERENCES', 'SCRIPT_READY'].includes(podcastStatus)) return 'script';
  if (['GENERATING_AUDIO', 'STITCHING'].includes(podcastStatus)) return 'audio';
  if (!videoStatus || videoStatus === 'PENDING') return 'audio';
  if (videoStatus === 'CLASSIFYING' || videoStatus === 'GENERATING_VISUALS') return 'visuals';
  if (videoStatus === 'GENERATING_TRANSITIONS') return 'transitions';
  if (videoStatus === 'GENERATING_AVATARS') return 'avatars';
  if (videoStatus === 'COMPOSING') return 'composing';
  if (videoStatus === 'READY') return 'ready';
  return 'script';
}

/** Step definitions for the workflow */
type StepId = 'create' | 'script' | 'voices' | 'visuals' | 'avatars' | 'generate' | 'preview';

interface StepDef {
  id: StepId;
  label: string;
  number: number;
}

const STEPS: StepDef[] = [
  { id: 'create', label: 'Create / Select', number: 1 },
  { id: 'script', label: 'Script', number: 2 },
  { id: 'voices', label: 'Voices', number: 3 },
  { id: 'visuals', label: 'Visuals', number: 4 },
  { id: 'avatars', label: 'Avatars', number: 5 },
  { id: 'generate', label: 'Generate', number: 6 },
  { id: 'preview', label: 'Preview', number: 7 },
];

/** Determine which steps are unlocked based on podcast status */
function getUnlockedSteps(podcastStatus: string | undefined): Set<StepId> {
  const unlocked = new Set<StepId>(['create']);
  if (!podcastStatus) return unlocked;

  // Script step: unlocked when script exists (SCRIPT_READY or later)
  const scriptReadyStatuses = ['SCRIPT_READY', 'GENERATING_AUDIO', 'STITCHING', 'READY'];
  if (scriptReadyStatuses.includes(podcastStatus)) {
    unlocked.add('script');
  }

  // Voices step: unlocked at SCRIPT_READY or later
  if (scriptReadyStatuses.includes(podcastStatus)) {
    unlocked.add('voices');
  }

  // Visuals step: unlocked only when audio is done (READY)
  if (podcastStatus === 'READY') {
    unlocked.add('visuals');
    unlocked.add('avatars');
    unlocked.add('generate');
  }

  // Preview: unlocked when video generation is done (or audio is ready for audio-only preview)
  // The component itself checks videoStatus internally
  if (podcastStatus === 'READY') {
    unlocked.add('preview');
  }

  return unlocked;
}

/** Determine the best default step based on status */
function getDefaultStep(podcastStatus: string | undefined): StepId {
  if (!podcastStatus) return 'create';
  if (podcastStatus === 'READY') return 'visuals';
  if (podcastStatus === 'SCRIPT_READY') return 'script';
  if (IN_PROGRESS_STATUSES.includes(podcastStatus)) return 'create';
  return 'create';
}

interface ShowcaseBuilderProps {
  providers: ProviderInfo[];
}

export function ShowcaseBuilder({ providers }: ShowcaseBuilderProps) {
  const [podcasts, setPodcasts] = useState<PodcastOption[]>([]);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string>('');
  const [segments, setSegments] = useState<SegmentData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [voiceCache, setVoiceCache] = useState<Record<string, CatalogVoice[]>>({});
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [activeStep, setActiveStep] = useState<StepId>('create');

  // Video/generation state
  const [videoStatus, setVideoStatus] = useState<string | null>(null);
  const [avatarsVisible, setAvatarsVisible] = useState(true);
  const [generatingAll, setGeneratingAll] = useState(false);
  const videoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AI model state
  const [aiModels, setAiModels] = useState<AiModelOption[]>([]);

  // Creation form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createTopic, setCreateTopic] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createDuration, setCreateDuration] = useState(2);
  const [createFeatures, setCreateFeatures] = useState<Set<string>>(new Set());
  const [createAiModel, setCreateAiModel] = useState('');

  // Polling ref for in-progress podcasts
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedPodcast = podcasts.find((p) => p.id === selectedPodcastId);
  const unlockedSteps = getUnlockedSteps(selectedPodcast?.status);
  const isInProgress = selectedPodcast && IN_PROGRESS_STATUSES.includes(selectedPodcast.status);

  // Fetch eligible podcasts
  const fetchPodcasts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/showcase');
      const d = await res.json();
      setPodcasts(d.podcasts ?? []);
      return d.podcasts ?? [];
    } catch {
      setMessage('Failed to load podcasts');
      return [];
    }
  }, []);

  // Fetch available AI models
  const fetchAiModels = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-models');
      if (!res.ok) return;
      const d = await res.json();
      setAiModels(d.models ?? []);
    } catch {
      // Non-critical — selector will be empty
    }
  }, []);

  useEffect(() => {
    fetchPodcasts();
    fetchAiModels();
  }, [fetchPodcasts, fetchAiModels]);

  // Poll for status updates when a selected podcast is in progress
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (!selectedPodcast || !IN_PROGRESS_STATUSES.includes(selectedPodcast.status)) return;

    pollRef.current = setInterval(async () => {
      const updated = await fetchPodcasts();
      const current = updated.find((p: PodcastOption) => p.id === selectedPodcastId);
      if (current && !IN_PROGRESS_STATUSES.includes(current.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (current.status === 'SCRIPT_READY' || current.status === 'READY') {
          setMessage(`Demo "${current.title}" is ready`);
          setStatus('success');
          loadSegments(current.id);
          setActiveStep(getDefaultStep(current.status));
        }
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedPodcastId, podcasts, fetchPodcasts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load segments when podcast is selected
  const loadSegments = useCallback(async (podcastId: string) => {
    setSelectedPodcastId(podcastId);
    setSelected(new Set());
    setBoundaries([]);
    if (!podcastId) {
      setSegments([]);
      setActiveStep('create');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch(`/api/admin/showcase/${podcastId}/segments`);
      const data = await res.json();
      setSegments(data.segments ?? []);
      setStatus('idle');
    } catch {
      setMessage('Failed to load segments');
      setStatus('error');
    }
  }, []);

  // When podcast is selected, update active step
  const handlePodcastSelect = useCallback(async (podcastId: string) => {
    await loadSegments(podcastId);
    const podcast = podcasts.find((p) => p.id === podcastId);
    setActiveStep(getDefaultStep(podcast?.status));
  }, [loadSegments, podcasts]);

  // Callback for when script/audio status changes (from ScriptReviewPanel)
  const handleStatusChange = useCallback(async () => {
    const updated = await fetchPodcasts();
    const current = updated.find((p: PodcastOption) => p.id === selectedPodcastId);
    if (current) {
      setActiveStep(getDefaultStep(current.status));
    }
  }, [fetchPodcasts, selectedPodcastId]);

  // Fetch video generation status
  const fetchVideoStatus = useCallback(async (podcastId: string) => {
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/video`);
      if (!res.ok) return;
      const data = await res.json();
      setVideoStatus(data.status ?? null);
      if (data.avatarsVisible !== undefined) setAvatarsVisible(data.avatarsVisible);
    } catch {
      // Non-critical
    }
  }, []);

  // Poll video status when generation is in progress
  useEffect(() => {
    if (videoPollRef.current) {
      clearInterval(videoPollRef.current);
      videoPollRef.current = null;
    }

    if (!selectedPodcastId || !videoStatus || !VIDEO_IN_PROGRESS_STATUSES.includes(videoStatus)) return;

    videoPollRef.current = setInterval(async () => {
      await fetchVideoStatus(selectedPodcastId);
    }, 3000);

    return () => {
      if (videoPollRef.current) clearInterval(videoPollRef.current);
    };
  }, [selectedPodcastId, videoStatus, fetchVideoStatus]);

  // Fetch video status when podcast is selected and READY
  useEffect(() => {
    if (selectedPodcast?.status === 'READY' && selectedPodcastId) {
      fetchVideoStatus(selectedPodcastId);
    }
  }, [selectedPodcast?.status, selectedPodcastId, fetchVideoStatus]);

  // Generate everything (state-machine orchestrator)
  const generateAll = useCallback(async () => {
    if (!selectedPodcastId) return;
    setGeneratingAll(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/showcase/${selectedPodcastId}/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Generate failed');
      }
      const data = await res.json();
      setMessage(data.message);
      setStatus('success');

      // Refresh podcast list to pick up status change
      await fetchPodcasts();

      // Start video polling if video step was triggered
      if (data.videoStatus) {
        setVideoStatus(data.videoStatus);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Generate failed');
      setStatus('error');
    } finally {
      setGeneratingAll(false);
    }
  }, [selectedPodcastId, fetchPodcasts]);

  // Fetch voice catalog for a provider (cached)
  const getVoices = useCallback(async (providerId: string): Promise<CatalogVoice[]> => {
    if (voiceCache[providerId]) return voiceCache[providerId];
    try {
      const res = await fetch(`/api/admin/showcase/voices?provider=${providerId}`);
      const data = await res.json();
      const voices = data.voices ?? [];
      setVoiceCache((prev) => ({ ...prev, [providerId]: voices }));
      return voices;
    } catch {
      return [];
    }
  }, [voiceCache]);

  // Update a single segment's assignment
  const updateSegment = useCallback((segmentId: string, field: string, value: string | null) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === segmentId ? { ...s, [field]: value } : s))
    );
  }, []);

  // Handle provider change for a segment — load voices
  const handleProviderChange = useCallback(async (segmentId: string, providerId: string) => {
    updateSegment(segmentId, 'ttsProvider', providerId || null);
    updateSegment(segmentId, 'ttsModel', null);
    updateSegment(segmentId, 'ttsVoiceId', null);
    if (providerId) {
      await getVoices(providerId);
    }
  }, [updateSegment, getVoices]);

  // Toggle segment selection
  const toggleSelect = useCallback((segmentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === segments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(segments.map((s) => s.id)));
    }
  }, [selected.size, segments]);

  // Bulk assign provider to selected segments
  const bulkAssign = useCallback(async (providerId: string) => {
    if (!providerId || selected.size === 0) return;
    await getVoices(providerId);
    setSegments((prev) =>
      prev.map((s) =>
        selected.has(s.id)
          ? { ...s, ttsProvider: providerId, ttsModel: null, ttsVoiceId: null }
          : s
      )
    );
  }, [selected, getVoices]);

  // Save assignments
  const saveAssignments = useCallback(async () => {
    if (!selectedPodcastId) return;
    setStatus('saving');
    setMessage('');
    try {
      const assignments = segments
        .filter((s) => s.ttsProvider)
        .map((s) => ({
          segmentId: s.id,
          ttsProvider: s.ttsProvider!,
          ttsModel: s.ttsModel ?? undefined,
          ttsVoiceId: s.ttsVoiceId ?? undefined,
        }));

      const res = await fetch(`/api/admin/showcase/${selectedPodcastId}/segments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Save failed');
      }
      setMessage(`Saved ${assignments.length} assignments`);
      setStatus('success');

      // Refresh boundaries
      const bRes = await fetch(`/api/admin/showcase/${selectedPodcastId}/boundaries`);
      const bData = await bRes.json();
      setBoundaries(bData.boundaries ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
      setStatus('error');
    }
  }, [selectedPodcastId, segments]);

  // Generate audio
  const generateAudio = useCallback(async () => {
    if (!selectedPodcastId) return;
    setStatus('generating');
    setMessage('');
    try {
      const res = await fetch(`/api/admin/showcase/${selectedPodcastId}/generate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Generate failed');
      }
      const data = await res.json();
      setMessage(`Queued ${data.queued} segments for audio generation`);
      setStatus('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Generate failed');
      setStatus('error');
    }
  }, [selectedPodcastId]);

  // Generate video with transitions at provider boundaries
  const generateVideo = useCallback(async () => {
    if (!selectedPodcastId) return;
    setStatus('generating');
    setMessage('');
    try {
      const res = await fetch(`/api/admin/showcase/${selectedPodcastId}/video`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Video trigger failed');
      }
      const data = await res.json();
      setMessage(`Video pipeline started — ${data.transitionsCreated} provider transition(s) created`);
      setStatus('success');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Video trigger failed');
      setStatus('error');
    }
  }, [selectedPodcastId]);

  // Create demo podcast
  const createDemo = useCallback(async () => {
    if (!createTopic.trim()) return;
    setStatus('creating');
    setMessage('');
    try {
      const res = await fetch('/api/admin/showcase/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: createTopic.trim(),
          title: createTitle.trim() || undefined,
          featureFocus: createFeatures.size > 0 ? [...createFeatures] : undefined,
          durationTarget: createDuration,
          aiModel: createAiModel || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Create failed');
      }
      const data = await res.json();

      // Refresh podcast list and select the new one
      const updated = await fetchPodcasts();
      const newPodcast = updated.find((p: PodcastOption) => p.id === data.podcastId);
      if (newPodcast) {
        setSelectedPodcastId(data.podcastId);
      }

      setMessage(`Demo created — generating script...`);
      setStatus('success');
      setShowCreateForm(false);
      setCreateTopic('');
      setCreateTitle('');
      setCreateDuration(2);
      setCreateFeatures(new Set());
      setCreateAiModel('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Create failed');
      setStatus('error');
    }
  }, [createTopic, createTitle, createDuration, createFeatures, createAiModel, fetchPodcasts]);

  // Toggle feature selection
  const toggleFeature = useCallback((slug: string) => {
    setCreateFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const providerMap = Object.fromEntries(providers.map((p) => [p.id, p]));

  // Find boundary after a segment
  const getBoundaryAfter = (segmentId: string) =>
    boundaries.find((b) => b.afterSegmentId === segmentId);

  // Navigate to a step (only if unlocked)
  const goToStep = useCallback((stepId: StepId) => {
    if (unlockedSteps.has(stepId)) {
      setActiveStep(stepId);
    }
  }, [unlockedSteps]);

  return (
    <div className={styles.root}>
      {/* Step navigation */}
      <nav className={styles.stepNav} aria-label="Workflow steps">
        {STEPS.map((step) => {
          const isUnlocked = unlockedSteps.has(step.id);
          const isActive = activeStep === step.id;
          return (
            <button
              key={step.id}
              type="button"
              className={styles.stepBtn}
              data-active={isActive}
              data-unlocked={isUnlocked}
              onClick={() => goToStep(step.id)}
              disabled={!isUnlocked}
              aria-current={isActive ? 'step' : undefined}
              aria-label={`Step ${step.number}: ${step.label}${!isUnlocked ? ' (locked)' : ''}`}
            >
              <span className={styles.stepNumber}>{step.number}</span>
              <span className={styles.stepLabel}>{step.label}</span>
            </button>
          );
        })}
      </nav>

      {/* In-progress status */}
      {isInProgress && (
        <div className={styles.progressBanner} role="status">
          <span className={styles.spinner} />
          {selectedPodcast.title} — {selectedPodcast.status.replace(/_/g, ' ').toLowerCase()}...
        </div>
      )}

      {/* Step 1: Create / Select */}
      {activeStep === 'create' && (
        <div className={styles.stepContent}>
          {/* Create Demo section */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Create Demo</legend>
            {!showCreateForm ? (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setShowCreateForm(true)}
              >
                Create Demo Podcast
              </button>
            ) : (
              <div className={styles.createForm}>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="demo-topic">
                    Topic *
                  </label>
                  <textarea
                    id="demo-topic"
                    className={styles.textarea}
                    value={createTopic}
                    onChange={(e) => setCreateTopic(e.target.value)}
                    placeholder="e.g., How Sotto turns any conversation into a podcast"
                    rows={2}
                    maxLength={500}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="demo-title">
                    Title (optional)
                  </label>
                  <input
                    id="demo-title"
                    type="text"
                    className={styles.input}
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="Auto-generated from topic if blank"
                    maxLength={200}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel}>
                    Duration: {createDuration} min
                  </label>
                  <input
                    type="range"
                    className={styles.slider}
                    min={1}
                    max={3}
                    step={0.5}
                    value={createDuration}
                    onChange={(e) => setCreateDuration(Number(e.target.value))}
                    aria-label="Duration target in minutes"
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="demo-ai-model">
                    AI Model
                  </label>
                  <select
                    id="demo-ai-model"
                    className={styles.select}
                    value={createAiModel}
                    onChange={(e) => setCreateAiModel(e.target.value)}
                    aria-label="AI model for script generation"
                  >
                    <option value="">Auto (platform default)</option>
                    {aiModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}{m.hint ? ` (${m.hint})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel}>Feature Focus</label>
                  <div className={styles.featureGrid}>
                    {FEATURE_OPTIONS.map((f) => (
                      <label key={f.slug} className={styles.featureChip} data-selected={createFeatures.has(f.slug)}>
                        <input
                          type="checkbox"
                          checked={createFeatures.has(f.slug)}
                          onChange={() => toggleFeature(f.slug)}
                          className={styles.hiddenCheckbox}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={createDemo}
                    disabled={!createTopic.trim() || status === 'creating'}
                  >
                    {status === 'creating' ? 'Creating...' : 'Create Demo'}
                  </button>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </fieldset>

          {/* Podcast selector */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Select Podcast</legend>
            <select
              className={styles.select}
              value={selectedPodcastId}
              onChange={(e) => handlePodcastSelect(e.target.value)}
              aria-label="Select a podcast"
            >
              <option value="">— Choose a podcast —</option>
              {podcasts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.segmentCount} segments, {p.status}{p.aiModel ? `, ${p.aiModel}` : ''})
                </option>
              ))}
            </select>
          </fieldset>

          {/* Selected podcast info */}
          {selectedPodcast && (
            <div className={styles.podcastInfo}>
              <h3 className={styles.podcastTitle}>{selectedPodcast.title}</h3>
              <div className={styles.podcastMeta}>
                <span className={styles.statusBadge} data-status={selectedPodcast.status}>
                  {selectedPodcast.status.replace(/_/g, ' ')}
                </span>
                <span className={styles.metaItem}>{selectedPodcast.segmentCount} segments</span>
                {selectedPodcast.aiModel && (
                  <span className={styles.metaItem}>Model: {selectedPodcast.aiModel}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Script Review */}
      {activeStep === 'script' && selectedPodcastId && (
        <div className={styles.stepContent}>
          <ScriptReviewPanel
            podcastId={selectedPodcastId}
            podcastStatus={selectedPodcast?.status ?? ''}
            onStatusChange={handleStatusChange}
          />
        </div>
      )}

      {/* Step 3: Voices — existing per-segment TTS assignment */}
      {activeStep === 'voices' && selectedPodcastId && (
        <div className={styles.stepContent}>
          {segments.length > 0 ? (
            <>
              {/* Range assignment toolbar */}
              <div className={styles.toolbar}>
                <label className={styles.toolbarLabel}>
                  <input
                    type="checkbox"
                    checked={selected.size === segments.length && segments.length > 0}
                    onChange={selectAll}
                    aria-label="Select all segments"
                  />
                  {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
                </label>
                {selected.size > 0 && (
                  <select
                    className={styles.selectSmall}
                    defaultValue=""
                    onChange={(e) => {
                      bulkAssign(e.target.value);
                      e.target.value = '';
                    }}
                    aria-label="Assign provider to selected segments"
                  >
                    <option value="" disabled>Assign provider...</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.displayName}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Segment list */}
              <div className={styles.segmentList} role="list" aria-label="Podcast segments">
                {segments.map((seg) => {
                  const boundary = getBoundaryAfter(seg.id);
                  return (
                    <div key={seg.id}>
                      <div
                        className={styles.segmentCard}
                        role="listitem"
                        data-has-provider={!!seg.ttsProvider}
                      >
                        <div className={styles.segmentHeader}>
                          <input
                            type="checkbox"
                            checked={selected.has(seg.id)}
                            onChange={() => toggleSelect(seg.id)}
                            aria-label={`Select segment ${seg.order}`}
                          />
                          <span className={styles.segmentOrder}>#{seg.order}</span>
                          <span className={styles.segmentSpeaker}>{seg.speaker}</span>
                          {seg.ttsProvider && (
                            <span
                              className={styles.providerBadge}
                              style={{ backgroundColor: PROVIDER_COLORS[seg.ttsProvider] ?? '#6b7280' }}
                            >
                              {providerMap[seg.ttsProvider]?.displayName ?? seg.ttsProvider}
                            </span>
                          )}
                          {seg.audioUrl && (
                            <span className={styles.audioBadge}>Has Audio</span>
                          )}
                        </div>

                        <p className={styles.segmentText}>
                          {seg.text.length > 150 ? `${seg.text.slice(0, 150)}...` : seg.text}
                        </p>

                        <div className={styles.segmentControls}>
                          <select
                            className={styles.selectSmall}
                            value={seg.ttsProvider ?? ''}
                            onChange={(e) => handleProviderChange(seg.id, e.target.value)}
                            aria-label={`Provider for segment ${seg.order}`}
                          >
                            <option value="">— Provider —</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>{p.displayName}</option>
                            ))}
                          </select>

                          {seg.ttsProvider && providerMap[seg.ttsProvider] && (
                            <select
                              className={styles.selectSmall}
                              value={seg.ttsModel ?? ''}
                              onChange={(e) => updateSegment(seg.id, 'ttsModel', e.target.value || null)}
                              aria-label={`Model for segment ${seg.order}`}
                            >
                              <option value="">Default model</option>
                              {providerMap[seg.ttsProvider].models.map((m) => (
                                <option key={m.id} value={m.id}>{m.displayName}</option>
                              ))}
                            </select>
                          )}

                          {seg.ttsProvider && voiceCache[seg.ttsProvider] && (
                            <select
                              className={styles.selectSmall}
                              value={seg.ttsVoiceId ?? ''}
                              onChange={(e) => updateSegment(seg.id, 'ttsVoiceId', e.target.value || null)}
                              aria-label={`Voice for segment ${seg.order}`}
                            >
                              <option value="">Auto-assign voice</option>
                              {voiceCache[seg.ttsProvider].map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}{v.gender ? ` (${v.gender})` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>

                      {/* Provider boundary indicator */}
                      {boundary && (
                        <div className={styles.boundary} aria-label="Provider transition boundary">
                          <span
                            className={styles.boundaryDot}
                            style={{ backgroundColor: PROVIDER_COLORS[boundary.fromProvider ?? ''] ?? '#6b7280' }}
                          />
                          <span className={styles.boundaryLine} />
                          <span className={styles.boundaryLabel}>
                            {providerMap[boundary.fromProvider ?? '']?.displayName ?? boundary.fromProvider}
                            {' → '}
                            {providerMap[boundary.toProvider ?? '']?.displayName ?? boundary.toProvider}
                          </span>
                          <span className={styles.boundaryLine} />
                          <span
                            className={styles.boundaryDot}
                            style={{ backgroundColor: PROVIDER_COLORS[boundary.toProvider ?? ''] ?? '#6b7280' }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Actions bar */}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={saveAssignments}
                  disabled={status === 'saving' || status === 'generating'}
                >
                  {status === 'saving' ? 'Saving...' : 'Save Assignments'}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={generateAudio}
                  disabled={status === 'saving' || status === 'generating'}
                >
                  {status === 'generating' ? 'Generating...' : 'Generate Audio'}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={generateVideo}
                  disabled={status === 'saving' || status === 'generating'}
                >
                  Generate Video
                </button>
              </div>
            </>
          ) : (
            <p className={styles.emptyStep}>No segments loaded. Approve the script first to create segments.</p>
          )}
        </div>
      )}

      {/* Step 4: Visuals — Pipeline editor */}
      {activeStep === 'visuals' && selectedPodcastId && (
        <div className={styles.stepContent}>
          <VisualPipelinePanel podcastId={selectedPodcastId} />
        </div>
      )}

      {/* Step 5: Avatars */}
      {activeStep === 'avatars' && selectedPodcastId && (
        <div className={styles.stepContent}>
          <AvatarPanel
            podcastId={selectedPodcastId}
            avatarsVisible={avatarsVisible}
            onAvatarsVisibleChange={setAvatarsVisible}
          />
        </div>
      )}

      {/* Step 6: Generate — Progress dashboard */}
      {activeStep === 'generate' && selectedPodcastId && (
        <div className={styles.stepContent}>
          {/* Pipeline progress bar */}
          <div className={styles.pipelineProgress}>
            {PIPELINE_STAGES.map((stage, i) => {
              const active = getActiveStage(selectedPodcast?.status ?? '', videoStatus);
              const activeIdx = PIPELINE_STAGES.findIndex((s) => s.key === active);
              const stageIdx = i;
              const isDone = stageIdx < activeIdx;
              const isCurrent = stageIdx === activeIdx;
              return (
                <div
                  key={stage.key}
                  className={styles.pipelineStage}
                  data-done={isDone}
                  data-current={isCurrent}
                >
                  <span className={styles.pipelineDot}>
                    {isDone ? '\u2713' : stage.key === 'ready' && isCurrent ? '\u2713' : i + 1}
                  </span>
                  <span className={styles.pipelineLabel}>{stage.label}</span>
                  {i < PIPELINE_STAGES.length - 1 && <span className={styles.pipelineConnector} data-done={isDone} />}
                </div>
              );
            })}
          </div>

          {/* Video status info */}
          {videoStatus && (
            <div className={styles.videoStatusCard}>
              <span className={styles.videoStatusLabel}>Video Pipeline</span>
              <span className={styles.videoStatusValue} data-status={videoStatus}>
                {videoStatus.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Generate All button */}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={generateAll}
              disabled={generatingAll || (selectedPodcast?.status !== 'SCRIPT_READY' && selectedPodcast?.status !== 'READY')}
            >
              {generatingAll ? 'Starting...' : 'Generate Everything'}
            </button>
            {selectedPodcast?.status === 'READY' && !videoStatus && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={generateAll}
                disabled={generatingAll}
              >
                Generate Video Only
              </button>
            )}
          </div>

          {/* Status explanation */}
          {selectedPodcast && selectedPodcast.status !== 'SCRIPT_READY' && selectedPodcast.status !== 'READY' && (
            <p className={styles.emptyStep}>
              Podcast is currently {selectedPodcast.status.replace(/_/g, ' ').toLowerCase()}. Wait for it to finish before generating.
            </p>
          )}
        </div>
      )}

      {/* Step 7: Preview & Publish */}
      {activeStep === 'preview' && selectedPodcastId && (
        <div className={styles.stepContent}>
          <PreviewPanel podcastId={selectedPodcastId} />
        </div>
      )}

      {/* Status banner */}
      {message && (
        <div
          className={styles.banner}
          data-variant={status === 'error' ? 'error' : 'success'}
          role="alert"
        >
          {message}
        </div>
      )}
    </div>
  );
}
