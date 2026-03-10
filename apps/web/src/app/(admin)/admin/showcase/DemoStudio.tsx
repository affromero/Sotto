'use client';

import { useState, useCallback, useEffect } from 'react';
import styles from './DemoStudio.module.css';
import { ActionEditor } from './ActionEditor';

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
}

type Step = 'features' | 'script' | 'voices' | 'assets' | 'preview';

const STEPS: { key: Step; label: string; number: number }[] = [
  { key: 'features', label: 'Features', number: 1 },
  { key: 'script', label: 'Script', number: 2 },
  { key: 'voices', label: 'Voices', number: 3 },
  { key: 'assets', label: 'Assets', number: 4 },
  { key: 'preview', label: 'Preview', number: 5 },
];

const FEATURE_OPTIONS = [
  'creation-flow', 'interrupt', 'fork', 'voice-comparison', 'import',
  'social-feed', 'byok', 'voice-cloning', 'script-review',
  'video-generation', 'collections', 'multi-speaker',
];

function featureLabel(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

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

export function DemoStudio({ providers }: { providers: ProviderInfo[] }) {
  const [projects, setProjects] = useState<DemoProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<DemoProject | null>(null);
  const [step, setStep] = useState<Step>('features');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [durationTarget, setDurationTarget] = useState(120);

  // Load projects
  const loadProjects = useCallback(async () => {
    const res = await fetch('/api/admin/demo');
    if (res.ok) setProjects(await res.json());
  }, []);

  // Load project with scenes
  const loadProject = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/demo/${id}`);
    if (res.ok) {
      const project: DemoProject = await res.json();
      setSelectedProject(project);
      // Auto-advance step based on status
      if (project.status === 'DRAFT') setStep('features');
      else if (project.status === 'SCRIPT_READY') setStep('script');
      else if (project.status === 'GENERATING_ASSETS') setStep('assets');
      else if (project.status === 'READY') setStep('preview');
      else setStep('features');
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Poll for status updates on selected project
  useEffect(() => {
    if (!selectedProject) return;
    if (selectedProject.status === 'DRAFT' || selectedProject.status === 'GENERATING_ASSETS') {
      const interval = setInterval(() => loadProject(selectedProject.id), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedProject, loadProject]);

  // Create project
  const createProject = useCallback(async () => {
    if (!title || features.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: description || undefined, features, durationTarget }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create project');
      }
      const { id } = await res.json();
      await loadProjects();
      await loadProject(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [title, description, features, durationTarget, loadProjects, loadProject]);

  // Save scene edits
  const saveScene = useCallback(async (sceneId: string, data: Partial<DemoScene>) => {
    if (!selectedProject) return;
    const res = await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) await loadProject(selectedProject.id);
  }, [selectedProject, loadProject]);

  // Generate individual asset
  const generateAsset = useCallback(async (sceneId: string, assetType: string) => {
    if (!selectedProject) return;
    await fetch(`/api/admin/demo/${selectedProject.id}/scenes/${sceneId}/${assetType}`, {
      method: 'POST',
    });
    await loadProject(selectedProject.id);
  }, [selectedProject, loadProject]);

  // Generate all assets
  const generateAllAssets = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    await fetch(`/api/admin/demo/${selectedProject.id}/generate-assets`, { method: 'POST' });
    await loadProject(selectedProject.id);
    setStep('assets');
    setLoading(false);
  }, [selectedProject, loadProject]);

  // Regenerate script
  const regenerateScript = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    await fetch(`/api/admin/demo/${selectedProject.id}/regenerate`, { method: 'POST' });
    await loadProject(selectedProject.id);
    setLoading(false);
  }, [selectedProject, loadProject]);

  // Compose final video
  const composeVideo = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    await fetch(`/api/admin/demo/${selectedProject.id}/compose`, { method: 'POST' });
    await loadProject(selectedProject.id);
    setStep('preview');
    setLoading(false);
  }, [selectedProject, loadProject]);

  // Delete project
  const deleteProject = useCallback(async (id: string) => {
    await fetch(`/api/admin/demo/${id}`, { method: 'DELETE' });
    if (selectedProject?.id === id) setSelectedProject(null);
    await loadProjects();
  }, [selectedProject, loadProjects]);

  const scenes = selectedProject?.scenes ?? [];
  const isUnlocked = (s: Step): boolean => {
    if (s === 'features') return true;
    if (!selectedProject) return false;
    const status = selectedProject.status;
    if (s === 'script') return status !== 'DRAFT';
    if (s === 'voices') return status !== 'DRAFT';
    if (s === 'assets') return status !== 'DRAFT';
    if (s === 'preview') return status === 'READY' || status === 'COMPOSING';
    return false;
  };

  return (
    <div className={styles.root}>
      {/* Step navigation */}
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
          </button>
        ))}
      </nav>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Step 1: Features */}
      {step === 'features' && (
        <div className={styles.panel}>
          {/* Project list */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Demo Projects</h2>
            {projects.length === 0 ? (
              <p className={styles.emptyText}>No projects yet. Create one below.</p>
            ) : (
              <div className={styles.projectList}>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className={styles.projectCard}
                    data-selected={selectedProject?.id === p.id ? 'true' : undefined}
                    onClick={() => loadProject(p.id)}
                  >
                    <span className={styles.projectTitle}>{p.title}</span>
                    <span className={styles.projectMeta}>
                      {p._count?.scenes ?? 0} scenes &middot; {p.status}
                    </span>
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                      aria-label="Delete project"
                    >
                      &times;
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Create form */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>New Demo</h2>
            <div className={styles.formGrid}>
              <label className={styles.formLabel}>
                Title
                <input
                  type="text"
                  className={styles.input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My Product Demo"
                />
              </label>
              <label className={styles.formLabel}>
                Description
                <textarea
                  className={styles.textarea}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={2}
                />
              </label>
              <fieldset className={styles.fieldset}>
                <legend className={styles.formLabel}>Features to demonstrate</legend>
                <div className={styles.chipGrid}>
                  {FEATURE_OPTIONS.map((f) => (
                    <button
                      key={f}
                      className={styles.chip}
                      data-selected={features.includes(f) ? 'true' : undefined}
                      onClick={() => setFeatures((prev) =>
                        prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
                      )}
                    >
                      {featureLabel(f)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className={styles.formLabel}>
                Duration target: {durationTarget}s
                <input
                  type="range"
                  min={30}
                  max={300}
                  step={10}
                  value={durationTarget}
                  onChange={(e) => setDurationTarget(Number(e.target.value))}
                  className={styles.slider}
                />
              </label>
              <button
                className={styles.primaryBtn}
                onClick={createProject}
                disabled={loading || !title || features.length === 0}
              >
                {loading ? 'Creating...' : 'Create Demo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Script */}
      {step === 'script' && selectedProject && (
        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Walkthrough Script</h2>
            <button
              className={styles.secondaryBtn}
              onClick={regenerateScript}
              disabled={loading}
            >
              Regenerate Script
            </button>
          </div>
          {selectedProject.status === 'DRAFT' ? (
            <p className={styles.emptyText}>Generating script...</p>
          ) : (
            <div className={styles.sceneList}>
              {scenes.map((scene) => (
                <SceneEditor
                  key={scene.id}
                  scene={scene}
                  onSave={(data) => saveScene(scene.id, data)}
                />
              ))}
            </div>
          )}
          {scenes.length > 0 && (
            <button className={styles.primaryBtn} onClick={() => setStep('voices')}>
              Continue to Voices
            </button>
          )}
        </div>
      )}

      {/* Step 3: Voices */}
      {step === 'voices' && selectedProject && (
        <div className={styles.panel}>
          <h2 className={styles.sectionTitle}>Voice Configuration</h2>
          <div className={styles.sceneList}>
            {scenes.map((scene) => (
              <VoiceConfig
                key={scene.id}
                scene={scene}
                providers={providers}
                onSave={(data) => saveScene(scene.id, data)}
              />
            ))}
          </div>
          <button className={styles.primaryBtn} onClick={() => setStep('assets')}>
            Continue to Assets
          </button>
        </div>
      )}

      {/* Step 4: Assets */}
      {step === 'assets' && selectedProject && (
        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Asset Generation</h2>
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
          {scenes.every((s) => s.recordingStatus === 'READY' && s.voiceoverStatus === 'READY') && (
            <button className={styles.primaryBtn} onClick={composeVideo} disabled={loading}>
              Compose Final Video
            </button>
          )}
        </div>
      )}

      {/* Step 5: Preview */}
      {step === 'preview' && selectedProject && (
        <div className={styles.panel}>
          <h2 className={styles.sectionTitle}>Preview</h2>
          {selectedProject.status === 'COMPOSING' ? (
            <p className={styles.emptyText}>Composing final video...</p>
          ) : selectedProject.videoUrl ? (
            <div className={styles.previewContainer}>
              <video
                className={styles.videoPlayer}
                src={selectedProject.videoUrl}
                controls
                preload="metadata"
              />
              <a
                className={styles.primaryBtn}
                href={selectedProject.videoUrl}
                download
              >
                Download Video
              </a>
            </div>
          ) : (
            <p className={styles.emptyText}>
              No video yet. Go to Assets and generate all assets, then compose.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function SceneEditor({
  scene,
  onSave,
}: {
  scene: DemoScene;
  onSave: (data: Partial<DemoScene>) => void;
}) {
  const [title, setTitle] = useState(scene.title);
  const [narration, setNarration] = useState(scene.narration);
  const [actions, setActions] = useState(scene.actions);
  const [expanded, setExpanded] = useState(false);
  const dirty = title !== scene.title || narration !== scene.narration || actions !== scene.actions;

  return (
    <div className={styles.sceneCard}>
      <button className={styles.sceneHeader} onClick={() => setExpanded(!expanded)}>
        <span className={styles.sceneOrder}>{scene.order + 1}</span>
        <span className={styles.sceneTitle}>{scene.title}</span>
        <span className={styles.expandIcon}>{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className={styles.sceneBody}>
          <label className={styles.formLabel}>
            Title
            <input
              type="text"
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className={styles.formLabel}>
            Narration
            <textarea
              className={styles.textarea}
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              rows={4}
            />
          </label>
          <div className={styles.formLabel}>
            Actions ({(actions as unknown[]).length} steps)
            <ActionEditor
              actions={actions as Array<Record<string, unknown>>}
              onChange={setActions}
            />
          </div>
          {dirty && (
            <button
              className={styles.secondaryBtn}
              onClick={() => onSave({ title, narration, actions })}
            >
              Save Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function VoiceConfig({
  scene,
  providers,
  onSave,
}: {
  scene: DemoScene;
  providers: ProviderInfo[];
  onSave: (data: Partial<DemoScene>) => void;
}) {
  const [ttsProvider, setTtsProvider] = useState(scene.ttsProvider ?? '');
  const [ttsModel, setTtsModel] = useState(scene.ttsModel ?? '');
  const [ttsVoiceId, setTtsVoiceId] = useState(scene.ttsVoiceId ?? '');

  const selectedProvider = providers.find((p) => p.id === ttsProvider);

  return (
    <div className={styles.sceneCard}>
      <div className={styles.sceneHeader}>
        <span className={styles.sceneOrder}>{scene.order + 1}</span>
        <span className={styles.sceneTitle}>{scene.title}</span>
      </div>
      <div className={styles.voiceForm}>
        <label className={styles.formLabel}>
          Provider
          <select
            className={styles.select}
            value={ttsProvider}
            onChange={(e) => { setTtsProvider(e.target.value); setTtsModel(''); setTtsVoiceId(''); }}
          >
            <option value="">Default (ElevenLabs)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        </label>
        {selectedProvider && (
          <label className={styles.formLabel}>
            Model
            <select
              className={styles.select}
              value={ttsModel}
              onChange={(e) => setTtsModel(e.target.value)}
            >
              <option value="">Default ({selectedProvider.defaultModel})</option>
              {selectedProvider.models.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.formLabel}>
          Voice ID
          <input
            type="text"
            className={styles.input}
            value={ttsVoiceId}
            onChange={(e) => setTtsVoiceId(e.target.value)}
            placeholder="Voice ID (optional)"
          />
        </label>
        <button
          className={styles.secondaryBtn}
          onClick={() => onSave({
            ttsProvider: ttsProvider || undefined,
            ttsModel: ttsModel || undefined,
            ttsVoiceId: ttsVoiceId || undefined,
          } as Partial<DemoScene>)}
        >
          Save Voice
        </button>
      </div>
    </div>
  );
}

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
