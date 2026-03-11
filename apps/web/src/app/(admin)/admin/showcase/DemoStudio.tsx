'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import styles from './DemoStudio.module.css';
import { TimingEditor, computeAdjustedDuration, type TimingSegment } from './TimingEditor';
import { ScriptViewer } from './ScriptViewer';
import { PodcastPrep } from './PodcastPrep';
import { VideoReview } from './VideoReview';
import { AvatarPrep } from './AvatarPrep';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DemoScene {
  id: string;
  order: number;
  title: string;
  narration: string;
  actions: unknown[];
  duration: number | null;
  recordingUrl: string | null;
  recordingStatus: string;
  voiceoverUrl: string | null;
  voiceoverStatus: string;
  visualUrl: string | null;
  visualStatus: string;
  visualType: string | null;
  visualPrompt: string | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  ttsVoiceId: string | null;
  compositedUrl: string | null;
  compositedStatus: string;
  transitionType: string | null;
  transitionUrl: string | null;
  transitionStatus: string;
  timingSegments: TimingSegment[] | null;
  sfxConfig: unknown | null;
  providerBanner: unknown | null;
  avatarConfig: unknown | null;
  overlays: unknown | null;
  subtitles: unknown | null;
  actionTimingLog: unknown | null;
  failedReason: string | null;
}

interface TtsOption {
  id: string;
  displayName: string;
  badge?: string;
  group: string;
  hint?: string;
}

interface DemoProject {
  id: string;
  title: string;
  description: string | null;
  features: string[];
  status: string;
  failedReason: string | null;
  videoUrl: string | null;
  createdAt: string;
  scenes?: DemoScene[];
  _count?: { scenes: number };
  backgroundMusicUrl: string | null;
  backgroundMusicVolume: number | null;
  podcastId: string | null;
  avatarClipUrl: string | null;
}

type Step = 'script' | 'podcast' | 'video' | 'avatar' | 'assets' | 'timing' | 'compose';

const STEPS: { key: Step; label: string; number: number }[] = [
  { key: 'script', label: 'Script', number: 1 },
  { key: 'podcast', label: 'Podcast', number: 2 },
  { key: 'video', label: 'Video', number: 3 },
  { key: 'avatar', label: 'Avatar', number: 4 },
  { key: 'assets', label: 'Recording', number: 5 },
  { key: 'timing', label: 'Timing', number: 6 },
  { key: 'compose', label: 'Compose', number: 7 },
];

function statusBadge(status: string): string {
  switch (status) {
    case 'PENDING': return 'Pending';
    case 'GENERATING': return 'Generating...';
    case 'READY': return 'Ready';
    case 'FAILED': return 'Failed';
    default: return status;
  }
}


// ---------------------------------------------------------------------------
// Progress step text — mapped to actual worker breakpoints
// ---------------------------------------------------------------------------

type AssetLabel = 'Recording' | 'Voiceover' | 'Visual' | 'Transition' | 'Scene Compose' | 'Final Compose';

const PROGRESS_STEPS: Record<AssetLabel, { threshold: number; text: string }[]> = {
  Recording: [
    { threshold: 0, text: 'Queuing...' },
    { threshold: 10, text: 'Starting Remotion...' },
    { threshold: 20, text: 'Recording in progress...' },
    { threshold: 70, text: 'Downloading output...' },
    { threshold: 80, text: 'Uploading to storage...' },
  ],
  Voiceover: [
    { threshold: 0, text: 'Queuing...' },
    { threshold: 10, text: 'Resolving TTS provider...' },
    { threshold: 30, text: 'Generating speech...' },
    { threshold: 70, text: 'Uploading audio...' },
  ],
  Visual: [
    { threshold: 0, text: 'Queuing...' },
    { threshold: 10, text: 'Preparing prompt...' },
    { threshold: 20, text: 'Generating with AI...' },
    { threshold: 80, text: 'Uploading visual...' },
  ],
  Transition: [
    { threshold: 0, text: 'Queuing...' },
    { threshold: 10, text: 'Preparing...' },
    { threshold: 40, text: 'Downloading clips...' },
    { threshold: 70, text: 'Crossfading with FFmpeg...' },
  ],
  'Scene Compose': [
    { threshold: 0, text: 'Queuing...' },
    { threshold: 5, text: 'Probing durations...' },
    { threshold: 15, text: 'Rendering with Remotion...' },
    { threshold: 70, text: 'Downloading render...' },
    { threshold: 75, text: 'Uploading...' },
    { threshold: 85, text: 'Saving metadata...' },
  ],
  'Final Compose': [
    { threshold: 0, text: 'Queuing...' },
    { threshold: 5, text: 'Probing scene durations...' },
    { threshold: 8, text: 'Building composition...' },
    { threshold: 10, text: 'Rendering final video...' },
    { threshold: 65, text: 'Downloading render...' },
    { threshold: 70, text: 'Uploading video...' },
    { threshold: 80, text: 'Saving metadata...' },
  ],
};

function getProgressText(label: AssetLabel, progress: number): string {
  const steps = PROGRESS_STEPS[label];
  let text = steps[0].text;
  for (const step of steps) {
    if (progress >= step.threshold) text = step.text;
  }
  return text;
}

// ---------------------------------------------------------------------------
// useJobProgress — polls BullMQ job status
// ---------------------------------------------------------------------------

interface JobProgress {
  state: string;
  progress: number;
  failedReason: string | null;
}

function useJobProgress(jobId: string | null, onComplete?: () => void): JobProgress | null {
  const [data, setData] = useState<JobProgress | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; });

  useEffect(() => {
    if (!jobId) {
      // Reset data on next microtask to avoid synchronous setState in effect
      const id = requestAnimationFrame(() => setData(null));
      return () => cancelAnimationFrame(id);
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/demo/job-status/${jobId}`);
        if (cancelled) return;
        if (!res.ok) {
          setData(null);
          return;
        }
        const result: JobProgress = await res.json();
        setData(result);
        if (result.state === 'completed' || result.state === 'failed') {
          onCompleteRef.current?.();
          return;
        }
      } catch {
        if (cancelled) return;
        setData(null);
        return;
      }
      if (!cancelled) {
        timerId = window.setTimeout(poll, 1500);
      }
    };
    let timerId = window.setTimeout(poll, 300);
    return () => { cancelled = true; clearTimeout(timerId); };
  }, [jobId]);

  return data;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export function DemoStudio() {
  const [projects, setProjects] = useState<DemoProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<DemoProject | null>(null);
  const [step, setStep] = useState<Step>('script');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptJson, setScriptJson] = useState('');
  const [ttsOptions, setTtsOptions] = useState<TtsOption[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') setScriptJson(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/demo');
      if (!res.ok) {
        setError(`Failed to load projects: ${res.status} ${await res.text()}`);
        return;
      }
      setProjects(await res.json());
    } catch (err) {
      setError(`Failed to load projects: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const loadProject = useCallback(async (id: string, navigate = false) => {
    try {
      const res = await fetch(`/api/admin/demo/${id}`);
      if (!res.ok) {
        setError(`Failed to load project: ${res.status} ${await res.text()}`);
        return;
      }
      const project: DemoProject = await res.json();
      setSelectedProject(project);
      if (navigate) {
        if (project.status === 'SCRIPT_READY' || project.status === 'DRAFT') setStep('script');
        else if (project.status === 'READY') setStep('compose');
        else setStep('script');
      }
    } catch (err) {
      setError(`Failed to load project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const loadTtsOptions = useCallback(async () => {
    try {
      const res = await fetch('/api/tts-options');
      if (!res.ok) {
        setError(`Failed to load TTS options: ${res.status} ${await res.text()}`);
        return;
      }
      const data = await res.json();
      setTtsOptions(data.options ?? []);
    } catch (err) {
      setError(`Failed to load TTS options: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => { loadProjects(); loadTtsOptions(); }, [loadProjects, loadTtsOptions]);

  // Poll for status updates
  useEffect(() => {
    if (!selectedProject) return;
    const scenesGenerating = selectedProject.scenes?.some((s) => s.compositedStatus === 'GENERATING');
    if (selectedProject.status === 'DRAFT' || selectedProject.status === 'GENERATING_ASSETS' || selectedProject.status === 'COMPOSING' || scenesGenerating) {
      const interval = setInterval(() => loadProject(selectedProject.id), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedProject, loadProject]);

  // Import JSON script
  const importScript = useCallback(async () => {
    if (!scriptJson.trim()) return;
    setLoading(true);
    setError(null);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(scriptJson); } catch { throw new Error('Invalid JSON'); }

      // If no project selected, create one
      if (!selectedProject) {
        const res = await fetch('/api/admin/demo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Launch Video', scriptJson: parsed }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create project');
        }
        const { id } = await res.json();
        await loadProjects();
        await loadProject(id, true);
      } else {
        // Import into existing project
        const res = await fetch(`/api/admin/demo/${selectedProject.id}/import-script`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: parsed }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to import script');
        }
        await loadProject(selectedProject.id, true);
      }
      setScriptJson('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [scriptJson, selectedProject, loadProjects, loadProject]);

  const saveScene = useCallback(async (sceneId: string, data: Partial<DemoScene>) => {
    if (!selectedProject) return;
    try {
      const res = await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        setError(`Failed to save scene: ${res.status} ${await res.text()}`);
        return;
      }
      await loadProject(selectedProject.id);
    } catch (err) {
      setError(`Failed to save scene: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selectedProject, loadProject]);

  const generateAsset = useCallback(async (sceneId: string, assetType: string): Promise<string | undefined> => {
    if (!selectedProject) return undefined;
    try {
      const res = await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${sceneId}/${assetType}`, { method: 'POST' });
      if (!res.ok) {
        setError(`Failed to generate ${assetType}: ${res.status} ${await res.text()}`);
        return undefined;
      }
      const data = await res.json();
      await loadProject(selectedProject.id);
      return data.jobId as string | undefined;
    } catch (err) {
      setError(`Failed to generate ${assetType}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }, [selectedProject, loadProject]);

  const generateAllAssets = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/demo/${selectedProject.id}/generate-assets`, { method: 'POST' });
      if (!res.ok) {
        setError(`Failed to generate assets: ${res.status} ${await res.text()}`);
      }
      await loadProject(selectedProject.id);
    } catch (err) {
      setError(`Failed to generate assets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, loadProject]);

  const composeScene = useCallback(async (sceneId: string): Promise<string | undefined> => {
    if (!selectedProject) return undefined;
    try {
      const res = await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${sceneId}/compose`, { method: 'POST' });
      if (!res.ok) {
        setError(`Failed to compose scene: ${res.status} ${await res.text()}`);
        return undefined;
      }
      const data = await res.json();
      await loadProject(selectedProject.id);
      return data.jobId as string | undefined;
    } catch (err) {
      setError(`Failed to compose scene: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }, [selectedProject, loadProject]);

  const composeAllScenes = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      for (const scene of selectedProject.scenes ?? []) {
        const ready = scene.recordingStatus === 'READY' && scene.voiceoverStatus === 'READY';
        if (ready && scene.compositedStatus !== 'READY') {
          const res = await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${scene.id}/compose`, { method: 'POST' });
          if (!res.ok) {
            setError(`Failed to compose scene ${scene.order + 1}: ${res.status} ${await res.text()}`);
          }
        }
      }
      await loadProject(selectedProject.id);
    } catch (err) {
      setError(`Failed to compose scenes: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, loadProject]);

  const [composeVideoJobId, setComposeVideoJobId] = useState<string | null>(null);

  const composeVideo = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/demo/${selectedProject.id}/compose`, { method: 'POST' });
      if (!res.ok) {
        setError(`Failed to compose video: ${res.status} ${await res.text()}`);
        return;
      }
      const data = await res.json();
      if (data.jobId) setComposeVideoJobId(data.jobId);
      await loadProject(selectedProject.id);
      setStep('compose');
    } catch (err) {
      setError(`Failed to compose video: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, loadProject]);

  const deleteProject = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/demo/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(`Failed to delete project: ${res.status} ${await res.text()}`);
        return;
      }
      if (selectedProject?.id === id) setSelectedProject(null);
      await loadProjects();
    } catch (err) {
      setError(`Failed to delete project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selectedProject, loadProjects]);

  const scenes = selectedProject?.scenes ?? [];
  const hasScenes = scenes.length > 0;
  const hasRecordings = scenes.some((s) => s.recordingStatus === 'READY');
  const allAssetsReady = scenes.length > 0 && scenes.every((s) => s.recordingStatus === 'READY' && s.voiceoverStatus === 'READY');
  const allScenesComposed = allAssetsReady && scenes.every((s) => s.compositedStatus === 'READY');

  const isUnlocked = (s: Step): boolean => {
    if (s === 'script') return true;
    if (s === 'avatar') return true; // independent
    if (!selectedProject) return false;
    if (s === 'podcast') return hasScenes;
    if (s === 'video') return !!selectedProject.podcastId;
    if (s === 'assets') return hasScenes;
    if (s === 'timing') return hasRecordings;
    if (s === 'compose') return allScenesComposed;
    return false;
  };

  const composeVideoProgress = useJobProgress(composeVideoJobId, () => {
    setComposeVideoJobId(null);
    if (selectedProject) loadProject(selectedProject.id);
  });

  // Clear compose job when project finishes
  useEffect(() => {
    if (selectedProject?.status === 'READY' || selectedProject?.status === 'FAILED') {
      setComposeVideoJobId(null);
    }
  }, [selectedProject?.status]);

  const totalAdjustedDuration = scenes.reduce((sum, s) => {
    if (s.timingSegments && s.timingSegments.length > 0) {
      return sum + computeAdjustedDuration(s.timingSegments);
    }
    return sum + (s.duration ?? 0);
  }, 0);

  return (
    <div className={styles.root}>
      <nav className={styles.stepNav}>
        {STEPS.map((s) => (
          <button
            key={s.key}
            className={styles.stepBtn}
            data-active={step === s.key ? 'true' : undefined}
            data-unlocked={isUnlocked(s.key) ? 'true' : undefined}
            disabled={!isUnlocked(s.key)}
            onClick={() => setStep(s.key)}
          >
            <span className={styles.stepNumber}>{s.number}</span>
            {s.label}
            {!isUnlocked(s.key) && <span className={styles.lockIcon}>locked</span>}
          </button>
        ))}
      </nav>

      {error && <div className={styles.errorBanner}>{error}</div>}
      {selectedProject?.status === 'FAILED' && selectedProject.failedReason && (
        <div className={styles.errorBanner}>Project failed: {selectedProject.failedReason}</div>
      )}

      {/* Step 1: Script — project list + JSON import + scene viewer */}
      {step === 'script' && (
        <div className={styles.panel}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Projects</h2>
            {projects.length === 0 ? (
              <p className={styles.emptyText}>No projects yet. Import a JSON script below.</p>
            ) : (
              <div className={styles.projectList}>
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className={styles.projectCard}
                    role="button"
                    tabIndex={0}
                    data-selected={selectedProject?.id === p.id ? 'true' : undefined}
                    onClick={() => loadProject(p.id, true)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') loadProject(p.id, true); }}
                  >
                    <span className={styles.projectTitle}>{p.title}</span>
                    <span className={styles.projectMeta}>
                      {p._count?.scenes ?? p.scenes?.length ?? 0} scenes · {p.status}
                    </span>
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                      aria-label="Delete project"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Import Launch Video Script</h2>
            <div className={styles.importZone}>
              <textarea
                className={styles.importTextarea}
                value={scriptJson}
                onChange={(e) => setScriptJson(e.target.value)}
                placeholder='Paste your LaunchVideoScript JSON here...'
              />
              <div className={styles.importActions}>
                <button
                  className={styles.primaryBtn}
                  onClick={importScript}
                  disabled={loading || !scriptJson.trim()}
                >
                  {loading ? 'Importing...' : selectedProject ? 'Re-import Script' : 'Import & Create Project'}
                </button>
                <label className={styles.secondaryBtn} role="button" tabIndex={0}>
                  Upload JSON File
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className={styles.hiddenInput}
                    aria-label="Upload JSON file"
                  />
                </label>
              </div>
            </div>
          </div>

          {selectedProject && hasScenes && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Scene Overview</h2>
              <ScriptViewer scenes={scenes} />
            </div>
          )}
        </div>
      )}

      {/* Step 2: Podcast */}
      {step === 'podcast' && selectedProject && (
        <div className={styles.panel}>
          <h2 className={styles.sectionTitle}>Podcast Pre-Production</h2>
          <PodcastPrep project={selectedProject} />
        </div>
      )}

      {/* Step 3: Video */}
      {step === 'video' && selectedProject && (
        <div className={styles.panel}>
          <h2 className={styles.sectionTitle}>Video Segments</h2>
          <VideoReview project={selectedProject} />
        </div>
      )}

      {/* Step 4: Avatar */}
      {step === 'avatar' && (
        <div className={styles.panel}>
          <h2 className={styles.sectionTitle}>Avatar Pre-Production</h2>
          {selectedProject ? (
            <AvatarPrep project={selectedProject} />
          ) : (
            <p className={styles.emptyText}>Select or create a project first.</p>
          )}
        </div>
      )}

      {/* Step 5: Recording (Assets) */}
      {step === 'assets' && selectedProject && (
        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recording &amp; Voiceover</h2>
            <div className={styles.headerActions}>
              <button
                className={styles.secondaryBtn}
                onClick={composeAllScenes}
                disabled={loading || !allAssetsReady}
              >
                Compose All Scenes
              </button>
              <button
                className={styles.primaryBtn}
                onClick={generateAllAssets}
                disabled={loading}
              >
                Generate All
              </button>
            </div>
          </div>
          <div className={styles.assetGrid}>
            {scenes.map((scene) => (
              <div key={scene.id} className={styles.assetCard}>
                <div className={styles.assetCardHeader}>
                  <h3 className={styles.assetTitle}>
                    Scene {scene.order + 1}: {scene.title}
                  </h3>
                  <span className={styles.badge} data-status={scene.compositedStatus.toLowerCase()}>
                    {scene.compositedStatus === 'READY' ? 'Composed' : statusBadge(scene.compositedStatus)}
                  </span>
                </div>

                {/* TTS picker */}
                <TtsPicker
                  scene={scene}
                  ttsOptions={ttsOptions}
                  onSave={(data) => saveScene(scene.id, data)}
                />

                {/* Narration text */}
                {scene.narration && (
                  <p className={styles.sceneNarration}>{scene.narration}</p>
                )}

                {/* Asset row: voiceover first (sets timing), then recording, visual, transition */}
                <div className={styles.assetRow}>
                  <AssetStatus
                    label="Voiceover"
                    status={scene.voiceoverStatus}
                    url={scene.voiceoverUrl}
                    onGenerate={() => generateAsset(scene.id, 'voiceover')}
                    mediaType="audio"
                    description={ASSET_DESCRIPTIONS.Voiceover}
                    failedReason={scene.voiceoverStatus === 'FAILED' ? scene.failedReason : null}
                    onJobComplete={() => loadProject(selectedProject!.id)}
                  />
                  <AssetStatus
                    label="Recording"
                    status={scene.recordingStatus}
                    url={scene.recordingUrl}
                    onGenerate={() => generateAsset(scene.id, 'record')}
                    mediaType="video"
                    description={ASSET_DESCRIPTIONS.Recording}
                    failedReason={scene.recordingStatus === 'FAILED' ? scene.failedReason : null}
                    onJobComplete={() => loadProject(selectedProject!.id)}
                    disabled={scene.voiceoverStatus !== 'READY'}
                    disabledReason="Generate voiceover first — recording speed adapts to match its duration"
                  />
                  {scene.visualType && (
                    <AssetStatus
                      label="Visual"
                      status={scene.visualStatus}
                      url={scene.visualUrl}
                      onGenerate={() => generateAsset(scene.id, 'visual')}
                      mediaType={scene.visualType === 'ai_video' ? 'video' : 'image'}
                      description={ASSET_DESCRIPTIONS.Visual}
                      failedReason={scene.visualStatus === 'FAILED' ? scene.failedReason : null}
                      onJobComplete={() => loadProject(selectedProject!.id)}
                    />
                  )}
                  {scene.transitionType && (
                    <AssetStatus
                      label="Transition"
                      status={scene.transitionStatus}
                      url={scene.transitionUrl}
                      onGenerate={() => generateAsset(scene.id, 'transition')}
                      mediaType="video"
                      description={ASSET_DESCRIPTIONS.Transition}
                      failedReason={scene.transitionStatus === 'FAILED' ? scene.failedReason : null}
                      onJobComplete={() => loadProject(selectedProject!.id)}
                    />
                  )}
                </div>

                {/* Compose scene row */}
                <div className={styles.composeRow}>
                  <ComposeSceneButton
                    scene={scene}
                    onCompose={() => composeScene(scene.id)}
                    onJobComplete={() => loadProject(selectedProject!.id)}
                  />
                  {scene.compositedStatus === 'FAILED' && scene.failedReason && (
                    <p className={styles.failedReason}>{scene.failedReason}</p>
                  )}
                  {scene.compositedUrl && scene.compositedStatus === 'READY' && (
                    <ScenePreview url={scene.compositedUrl} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 6: Timing */}
      {step === 'timing' && selectedProject && (
        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Timing &amp; Speed</h2>
            {totalAdjustedDuration > 0 && (
              <span className={styles.totalDuration}>
                Total: {Math.floor(totalAdjustedDuration / 60)}:{(totalAdjustedDuration % 60).toFixed(1).padStart(4, '0')}
              </span>
            )}
          </div>
          <div className={styles.sceneList}>
            {scenes.map((scene) => (
              <TimingEditor
                key={scene.id}
                scene={scene}
                onSave={(data) => saveScene(scene.id, data)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Step 7: Compose */}
      {step === 'compose' && selectedProject && (
        <div className={styles.panel}>
          <h2 className={styles.sectionTitle}>Compose &amp; Preview</h2>
          {allScenesComposed && selectedProject.status !== 'READY' && selectedProject.status !== 'COMPOSING' && (
            <button className={styles.primaryBtn} onClick={composeVideo} disabled={loading}>
              {loading ? 'Composing...' : 'Compose Final Video'}
            </button>
          )}
          {selectedProject.status === 'COMPOSING' && (
            <div className={styles.generatingBanner}>
              <span className={styles.spinner} />
              <div style={{ flex: 1 }}>
                <strong>Composing final video...</strong>
                {composeVideoProgress ? (
                  <JobProgressBar
                    label="Final Compose"
                    progress={composeVideoProgress.progress}
                  />
                ) : (
                  <p className={styles.emptyText}>
                    SFX mixing, text overlays, avatar PiP, background music, and warm amber grading.
                  </p>
                )}
              </div>
            </div>
          )}
          {selectedProject.videoUrl && (
            <div className={styles.previewContainer}>
              <video
                className={styles.videoPlayer}
                src={selectedProject.videoUrl}
                controls
                preload="metadata"
              />
              <a className={styles.primaryBtn} href={selectedProject.videoUrl} download>
                Download Video
              </a>
            </div>
          )}
          {selectedProject.status === 'FAILED' && selectedProject.failedReason && (
            <div className={styles.errorBanner}>{selectedProject.failedReason}</div>
          )}
          {!selectedProject.videoUrl && selectedProject.status !== 'COMPOSING' && selectedProject.status !== 'FAILED' && !allScenesComposed && (
            <p className={styles.emptyText}>
              All scenes must be composed before creating the final video. Go to Recording step to compose each scene.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (kept in same file — small, tightly coupled)
// ---------------------------------------------------------------------------

function JobProgressBar({ label, progress }: { label: AssetLabel; progress: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(progress)));
  return (
    <div className={styles.progressContainer}>
      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ '--progress': pct } as React.CSSProperties}
        />
      </div>
      <div className={styles.progressText}>
        <span>{getProgressText(label, pct)}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

const ASSET_DESCRIPTIONS: Record<string, string> = {
  Voiceover: 'Generates TTS audio from the narration text using the selected voice. This sets the timing — recording speed adapts to match.',
  Recording: 'Captures a screen recording of the demo actions via Playwright. Playback speed is adjusted to match voiceover duration during composition.',
  Visual: 'Generates an AI visual (image or video) from the scene prompt. Used as B-roll or overlay in the final composition.',
  Transition: 'Creates a crossfade transition between this scene and the next using FFmpeg.',
};

function AssetStatus({
  label,
  status,
  url,
  onGenerate,
  mediaType,
  failedReason,
  onJobComplete,
  description,
  disabled,
  disabledReason,
}: {
  label: AssetLabel;
  status: string;
  url: string | null;
  onGenerate: () => Promise<string | undefined>;
  mediaType: 'video' | 'audio' | 'image';
  failedReason?: string | null;
  onJobComplete?: () => void;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const jobProgress = useJobProgress(jobId, () => {
    setJobId(null);
    onJobComplete?.();
  });

  // Clear job tracking when asset finishes via DB status
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== status && (status === 'READY' || status === 'FAILED')) {
      const id = requestAnimationFrame(() => setJobId(null));
      return () => cancelAnimationFrame(id);
    }
  }, [status]);

  const handleGenerate = useCallback(async () => {
    const id = await onGenerate();
    if (id) setJobId(id);
  }, [onGenerate]);

  const isGenerating = status === 'GENERATING';

  return (
    <div className={styles.assetItem}>
      <div className={styles.assetLabel}>
        <span>{label}</span>
        <span className={styles.badge} data-status={status.toLowerCase()}>
          {statusBadge(status)}
        </span>
      </div>
      {description && (
        <p className={styles.assetDescription}>{description}</p>
      )}
      {isGenerating && jobProgress && (
        <JobProgressBar label={label} progress={jobProgress.progress} />
      )}
      {status === 'FAILED' && failedReason && (
        <p className={styles.failedReason}>{failedReason}</p>
      )}
      {url && status === 'READY' && (
        <button className={styles.previewBtn} onClick={() => setPreviewing(!previewing)}>
          {previewing ? 'Hide' : 'Preview'}
        </button>
      )}
      {previewing && url && (
        <div className={styles.previewInline}>
          {mediaType === 'video' && <video src={url} controls className={styles.previewMedia} />}
          {mediaType === 'audio' && <audio src={url} controls className={styles.previewMedia} />}
          {mediaType === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={label} className={styles.previewMedia} />
          )}
        </div>
      )}
      <button
        className={styles.secondaryBtn}
        onClick={handleGenerate}
        disabled={isGenerating || disabled}
        title={disabled ? disabledReason : undefined}
      >
        {status === 'READY' || status === 'FAILED' ? 'Regenerate' : 'Generate'}
      </button>
      {disabled && disabledReason && (
        <p className={styles.assetBlockedHint}>{disabledReason}</p>
      )}
    </div>
  );
}

function ComposeSceneButton({
  scene,
  onCompose,
  onJobComplete,
}: {
  scene: DemoScene;
  onCompose: () => Promise<string | undefined>;
  onJobComplete?: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const sceneAssetsReady = scene.recordingStatus === 'READY' && scene.voiceoverStatus === 'READY';

  const jobProgress = useJobProgress(jobId, () => {
    setJobId(null);
    onJobComplete?.();
  });

  const prevCompStatusRef = useRef(scene.compositedStatus);
  useEffect(() => {
    const prev = prevCompStatusRef.current;
    prevCompStatusRef.current = scene.compositedStatus;
    if (prev !== scene.compositedStatus && (scene.compositedStatus === 'READY' || scene.compositedStatus === 'FAILED')) {
      const id = requestAnimationFrame(() => setJobId(null));
      return () => cancelAnimationFrame(id);
    }
  }, [scene.compositedStatus]);

  const handleCompose = useCallback(async () => {
    const id = await onCompose();
    if (id) setJobId(id);
  }, [onCompose]);

  const isComposing = scene.compositedStatus === 'GENERATING';

  return (
    <>
      <button
        className={styles.secondaryBtn}
        onClick={handleCompose}
        disabled={!sceneAssetsReady || isComposing}
      >
        {isComposing ? 'Composing...'
          : scene.compositedStatus === 'READY' ? 'Recompose Scene'
          : 'Compose Scene'}
      </button>
      {isComposing && jobProgress && (
        <JobProgressBar label="Scene Compose" progress={jobProgress.progress} />
      )}
    </>
  );
}

interface VoiceOption {
  id: string;
  name: string;
  gender?: string;
  accent?: string;
  character?: string;
}

function TtsPicker({
  scene,
  ttsOptions,
  onSave,
}: {
  scene: DemoScene;
  ttsOptions: TtsOption[];
  onSave: (data: Partial<DemoScene>) => void;
}) {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  // Parse current ttsProvider:ttsModel into the combined id format
  const currentId = scene.ttsProvider && scene.ttsModel
    ? `${scene.ttsProvider}:${scene.ttsModel}`
    : '';

  // Extract the provider portion from the selected option
  const currentProvider = currentId ? currentId.split(':')[0] : 'elevenlabs';

  // Fetch voices when provider changes
  useEffect(() => {
    let cancelled = false;
    async function fetchVoices() {
      setLoadingVoices(true);
      try {
        const res = await fetch(`/api/voices?provider=${currentProvider}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setVoices((data.poolVoices ?? []).map((v: VoiceOption) => ({
            id: v.id,
            name: v.name,
            gender: v.gender,
            accent: v.accent,
            character: v.character,
          })));
        }
      } catch {
        // Voice list unavailable — non-critical, picker falls back to "Default voice"
      }
      if (!cancelled) setLoadingVoices(false);
    }
    fetchVoices();
    return () => { cancelled = true; };
  }, [currentProvider]);

  return (
    <div className={styles.ttsPicker}>
      <select
        className={styles.select}
        value={currentId}
        onChange={(e) => {
          const val = e.target.value;
          if (!val) {
            onSave({ ttsProvider: null, ttsModel: null, ttsVoiceId: null } as Partial<DemoScene>);
            return;
          }
          const [provider, ...modelParts] = val.split(':');
          const model = modelParts.join(':');
          // Clear voice when switching provider — voice IDs differ per provider
          const prevProvider = currentId ? currentId.split(':')[0] : '';
          const clearVoice = provider !== prevProvider;
          onSave({
            ttsProvider: provider,
            ttsModel: model,
            ...(clearVoice ? { ttsVoiceId: null } : {}),
          } as Partial<DemoScene>);
        }}
        aria-label="TTS provider and model"
      >
        <option value="">Default (ElevenLabs)</option>
        {ttsOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.displayName}{opt.badge ? ` — ${opt.badge}` : ''}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={scene.ttsVoiceId ?? ''}
        onChange={(e) => {
          onSave({ ttsVoiceId: e.target.value || null } as Partial<DemoScene>);
        }}
        disabled={loadingVoices}
        aria-label="Voice"
      >
        <option value="">{loadingVoices ? 'Loading voices...' : 'Default voice'}</option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}{v.gender ? ` (${v.gender})` : ''}{v.character ? ` — ${v.character}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function ScenePreview({ url }: { url: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.scenePreview}>
      <button className={styles.previewBtn} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide Preview' : 'Preview Composed'}
      </button>
      {expanded && (
        <video
          src={url}
          controls
          preload="metadata"
          className={styles.scenePreviewVideo}
        />
      )}
    </div>
  );
}
