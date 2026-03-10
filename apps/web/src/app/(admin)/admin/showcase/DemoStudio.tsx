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

function statusColor(status: string): string {
  switch (status) {
    case 'READY': return 'var(--color-success, #22c55e)';
    case 'GENERATING': return 'var(--color-primary)';
    case 'FAILED': return 'var(--color-error, #ef4444)';
    default: return 'var(--color-text-secondary)';
  }
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
    const res = await fetch('/api/admin/demo');
    if (res.ok) setProjects(await res.json());
  }, []);

  const loadProject = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/demo/${id}`);
    if (res.ok) {
      const project: DemoProject = await res.json();
      setSelectedProject(project);
      if (project.status === 'SCRIPT_READY' || project.status === 'DRAFT') setStep('script');
      else if (project.status === 'READY') setStep('compose');
      else setStep('script');
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Poll for status updates
  useEffect(() => {
    if (!selectedProject) return;
    if (selectedProject.status === 'DRAFT' || selectedProject.status === 'GENERATING_ASSETS' || selectedProject.status === 'COMPOSING') {
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
        await loadProject(id);
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
        await loadProject(selectedProject.id);
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
    const res = await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) await loadProject(selectedProject.id);
  }, [selectedProject, loadProject]);

  const generateAsset = useCallback(async (sceneId: string, assetType: string) => {
    if (!selectedProject) return;
    await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${sceneId}/${assetType}`, { method: 'POST' });
    await loadProject(selectedProject.id);
  }, [selectedProject, loadProject]);

  const generateAllAssets = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    await fetch(`/api/admin/demo/${selectedProject.id}/generate-assets`, { method: 'POST' });
    await loadProject(selectedProject.id);
    setLoading(false);
  }, [selectedProject, loadProject]);

  const composeVideo = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    await fetch(`/api/admin/demo/${selectedProject.id}/compose`, { method: 'POST' });
    await loadProject(selectedProject.id);
    setStep('compose');
    setLoading(false);
  }, [selectedProject, loadProject]);

  const deleteProject = useCallback(async (id: string) => {
    await fetch(`/api/admin/demo/${id}`, { method: 'DELETE' });
    if (selectedProject?.id === id) setSelectedProject(null);
    await loadProjects();
  }, [selectedProject, loadProjects]);

  const scenes = selectedProject?.scenes ?? [];
  const hasScenes = scenes.length > 0;
  const hasRecordings = scenes.some((s) => s.recordingStatus === 'READY');
  const allAssetsReady = scenes.length > 0 && scenes.every((s) => s.recordingStatus === 'READY' && s.voiceoverStatus === 'READY');

  const isUnlocked = (s: Step): boolean => {
    if (s === 'script') return true;
    if (s === 'avatar') return true; // independent
    if (!selectedProject) return false;
    if (s === 'podcast') return hasScenes;
    if (s === 'video') return !!selectedProject.podcastId;
    if (s === 'assets') return hasScenes;
    if (s === 'timing') return hasRecordings;
    if (s === 'compose') return allAssetsReady;
    return false;
  };

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
                    onClick={() => loadProject(p.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') loadProject(p.id); }}
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
            <button
              className={styles.primaryBtn}
              onClick={generateAllAssets}
              disabled={loading}
            >
              Generate All
            </button>
          </div>
          <div className={styles.assetGrid}>
            {scenes.map((scene) => (
              <div key={scene.id} className={styles.assetCard}>
                <h3 className={styles.assetTitle}>
                  Scene {scene.order + 1}: {scene.title}
                </h3>
                <div className={styles.assetRow}>
                  <AssetStatus
                    label="Recording"
                    status={scene.recordingStatus}
                    url={scene.recordingUrl}
                    onGenerate={() => generateAsset(scene.id, 'record')}
                    mediaType="video"
                  />
                  <AssetStatus
                    label="Voiceover"
                    status={scene.voiceoverStatus}
                    url={scene.voiceoverUrl}
                    onGenerate={() => generateAsset(scene.id, 'voiceover')}
                    mediaType="audio"
                  />
                  {scene.visualType && (
                    <AssetStatus
                      label="Visual"
                      status={scene.visualStatus}
                      url={scene.visualUrl}
                      onGenerate={() => generateAsset(scene.id, 'visual')}
                      mediaType={scene.visualType === 'ai_video' ? 'video' : 'image'}
                    />
                  )}
                  {scene.transitionType && (
                    <AssetStatus
                      label="Transition"
                      status={scene.transitionStatus}
                      url={scene.transitionUrl}
                      onGenerate={() => generateAsset(scene.id, 'transition')}
                      mediaType="video"
                    />
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
          {allAssetsReady && selectedProject.status !== 'READY' && selectedProject.status !== 'COMPOSING' && (
            <button className={styles.primaryBtn} onClick={composeVideo} disabled={loading}>
              {loading ? 'Composing...' : 'Compose Final Video'}
            </button>
          )}
          {selectedProject.status === 'COMPOSING' && (
            <div className={styles.generatingBanner}>
              <span className={styles.spinner} />
              <div>
                <strong>Composing final video...</strong>
                <p className={styles.emptyText}>
                  SFX mixing, text overlays, avatar PiP, background music, and warm amber grading.
                </p>
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
          {!selectedProject.videoUrl && selectedProject.status !== 'COMPOSING' && !allAssetsReady && (
            <p className={styles.emptyText}>
              All recordings and voiceovers must be READY before composing.
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

function AssetStatus({
  label,
  status,
  url,
  onGenerate,
  mediaType,
}: {
  label: string;
  status: string;
  url: string | null;
  onGenerate: () => void;
  mediaType: 'video' | 'audio' | 'image';
}) {
  const [previewing, setPreviewing] = useState(false);

  return (
    <div className={styles.assetItem}>
      <div className={styles.assetLabel}>
        <span>{label}</span>
        <span className={styles.badge} style={{ color: statusColor(status) }}>
          {statusBadge(status)}
        </span>
      </div>
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
        onClick={onGenerate}
        disabled={status === 'GENERATING'}
      >
        {status === 'READY' || status === 'FAILED' ? 'Regenerate' : 'Generate'}
      </button>
    </div>
  );
}
