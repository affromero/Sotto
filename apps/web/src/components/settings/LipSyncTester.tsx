'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './LipSyncTester.module.css';

const DEFAULT_PROMPT = 'Welcome to Sotto. Let me tell you something fascinating today.';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — stable ElevenLabs voice
const CACHE_KEY = 'lip-sync-tester-cache';
const CACHE_TTL_MS = 15 * 60 * 1000;

interface AvatarModel {
  id: string;
  name: string;
  tier: 'standard' | 'premium';
  costPerMinute: number | null;
}


interface CacheData {
  audioDataUrl: string | null;
  avatarImageUrl: string;
  videoUrl: string | null;
  textPrompt: string;
  imagePrompt: string;
  selectedModel: string;
  expiresAt: number;
}

type Stage = 'idle' | 'generating-audio' | 'audio-ready' | 'generating-video' | 'video-ready' | 'error';

function formatPrice(costPerMinute: number | null): string {
  if (costPerMinute === null) return '';
  return ` — $${costPerMinute.toFixed(2)}/min`;
}

function loadCache(): CacheData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CacheData;
    if (Date.now() > data.expiresAt) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveCache(data: Omit<CacheData, 'expiresAt'>) {
  try {
    const entry: CacheData = { ...data, expiresAt: Date.now() + CACHE_TTL_MS };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function LipSyncTester() {
  const [stage, setStage] = useState<Stage>('idle');
  const [textPrompt, setTextPrompt] = useState(DEFAULT_PROMPT);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [avatarImageUrl, setAvatarImageUrl] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [models, setModels] = useState<AvatarModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const audioDataUrlRef = useRef<string | null>(null);

  // Restore cache on mount
  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      if (cached.audioDataUrl) {
        setAudioUrl(cached.audioDataUrl);
        audioDataUrlRef.current = cached.audioDataUrl;
      }
      if (cached.avatarImageUrl) setAvatarImageUrl(cached.avatarImageUrl);
      if (cached.videoUrl) setVideoUrl(cached.videoUrl);
      if (cached.textPrompt) setTextPrompt(cached.textPrompt);
      if (cached.imagePrompt) setImagePrompt(cached.imagePrompt);
      if (cached.selectedModel) setSelectedModel(cached.selectedModel);

      if (cached.videoUrl) setStage('video-ready');
      else if (cached.audioDataUrl) setStage('audio-ready');
    }
  }, []);

  // Fetch pro-included models with live pricing from pricetoken
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/avatar-models', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data?.models?.length) return;
        const apiModels: AvatarModel[] = data.models.map(
          (m: { id: string; name: string; tier: string; costPerMinute: number | null }) => ({
            id: m.id,
            name: m.name,
            tier: m.tier as 'standard' | 'premium',
            costPerMinute: m.costPerMinute,
          })
        );
        setModels(apiModels);
        setSelectedModel((prev) => {
          if (apiModels.some((m) => m.id === prev)) return prev;
          return apiModels[0].id;
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const generateAudio = useCallback(async () => {
    setStage('generating-audio');
    setError(null);
    setVideoUrl(null);

    try {
      const res = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: DEFAULT_VOICE_ID, text: textPrompt }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data.error === 'string' ? data.error : `Audio generation failed (${res.status})`;
        throw new Error(msg);
      }

      const blob = await res.blob();
      const dataUrl = await blobToDataUrl(blob);
      audioDataUrlRef.current = dataUrl;
      setAudioUrl(dataUrl);
      setStage('audio-ready');
      saveCache({
        audioDataUrl: dataUrl,
        avatarImageUrl,
        videoUrl: null,
        textPrompt,
        imagePrompt,
        selectedModel,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio generation failed');
      setStage('error');
    }
  }, [textPrompt, avatarImageUrl, imagePrompt, selectedModel]);

  const generateImage = useCallback(async () => {
    if (!imagePrompt.trim()) return;
    setGeneratingImage(true);
    setError(null);

    try {
      const res = await fetch('/api/avatar-images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `test-${Date.now()}`, prompt: imagePrompt }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data.error === 'string' ? data.error : `Image generation failed (${res.status})`;
        throw new Error(msg);
      }

      const data = await res.json();
      setAvatarImageUrl(data.imageUrl);
      saveCache({
        audioDataUrl: audioDataUrlRef.current,
        avatarImageUrl: data.imageUrl,
        videoUrl,
        textPrompt,
        imagePrompt,
        selectedModel,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setGeneratingImage(false);
    }
  }, [imagePrompt, videoUrl, textPrompt, selectedModel]);

  const generateVideo = useCallback(async () => {
    if (!audioUrl || !avatarImageUrl) return;

    setStage('generating-video');
    setError(null);
    setVideoUrl(null);
    setProgress(0);

    try {
      const submitRes = await fetch('/api/avatar-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioUrl,
          avatarImageUrl,
          avatarModelId: selectedModel,
        }),
      });

      if (!submitRes.ok) {
        const data = await submitRes.json().catch(() => ({}));
        const msg = typeof data.error === 'string' ? data.error : `Failed to queue test (${submitRes.status})`;
        throw new Error(msg);
      }

      const { jobId } = await submitRes.json();

      // Poll for completion (5min timeout)
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));

        const pollRes = await fetch(`/api/avatar-test?jobId=${jobId}`);
        if (!pollRes.ok) continue;

        const status = await pollRes.json();
        if (typeof status.progress === 'number') setProgress(status.progress);

        if (status.status === 'completed' && status.videoUrl) {
          setProgress(100);
          setVideoUrl(status.videoUrl);
          setStage('video-ready');
          saveCache({
            audioDataUrl: audioDataUrlRef.current,
            avatarImageUrl,
            videoUrl: status.videoUrl,
            textPrompt,
            imagePrompt,
            selectedModel,
          });
          return;
        }

        if (status.status === 'failed') {
          const msg = typeof status.error === 'string' ? status.error : 'Lip-sync generation failed';
          throw new Error(msg);
        }
      }

      throw new Error('Lip-sync generation timed out');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video generation failed');
      setStage('error');
    }
  }, [audioUrl, avatarImageUrl, selectedModel, textPrompt, imagePrompt]);

  const isGenerating = stage === 'generating-audio' || stage === 'generating-video';

  return (
    <section className={styles.root}>
      <h3 className={styles.title}>Lip-Sync Model Tester</h3>
      <p className={styles.subtitle}>Test avatar lip-sync models with a text prompt and image.</p>

      <div className={styles.form}>
        {/* Step 1: Text → Audio */}
        <div className={styles.field}>
          <label className={styles.label}>Text prompt</label>
          <input
            className={styles.input}
            value={textPrompt}
            onChange={(e) => setTextPrompt(e.target.value)}
            placeholder="Enter text to convert to speech..."
            disabled={isGenerating}
          />
        </div>

        <button
          className={`${styles.button} ${styles.buttonSecondary}`}
          onClick={generateAudio}
          disabled={!textPrompt.trim() || isGenerating}
        >
          {stage === 'generating-audio' ? 'Generating Audio...' : 'Generate Audio'}
        </button>

        {audioUrl && (
          <audio className={styles.audioPlayer} controls src={audioUrl} />
        )}

        {/* Step 2: Avatar image */}
        <div className={styles.field}>
          <label className={styles.label}>Avatar image URL</label>
          <input
            className={styles.input}
            value={avatarImageUrl}
            onChange={(e) => setAvatarImageUrl(e.target.value)}
            placeholder="Paste an image URL or generate one below..."
            disabled={isGenerating}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Or generate from prompt</label>
            <input
              className={styles.input}
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="Professional portrait, female, warm smile..."
              disabled={isGenerating || generatingImage}
            />
          </div>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={generateImage}
            disabled={!imagePrompt.trim() || isGenerating || generatingImage}
          >
            {generatingImage ? 'Generating...' : 'Generate'}
          </button>
        </div>

        {avatarImageUrl && (
          <img
            src={avatarImageUrl}
            alt="Avatar preview"
            style={{ width: 96, height: 96, borderRadius: 'var(--radius-md)', objectFit: 'cover' }}
          />
        )}

        {/* Step 3: Model selection + Generate */}
        <div className={styles.field}>
          <label className={styles.label}>Lip-sync model</label>
          <select
            className={styles.select}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isGenerating || models.length === 0}
          >
            {models.length === 0 && <option value="">Loading models…</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{formatPrice(m.costPerMinute)}{m.tier === 'premium' ? ' ★' : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={generateVideo}
          disabled={!audioUrl || !avatarImageUrl || !selectedModel || isGenerating}
        >
          {stage === 'generating-video' ? 'Generating Video...' : 'Generate Video'}
        </button>

        {stage === 'generating-video' && (
          <div className={styles.status}>
            <span className={styles.spinner} />
            Processing lip-sync…{progress > 0 ? ` ${progress}%` : ''}
          </div>
        )}

        {videoUrl && (
          <video className={styles.videoPlayer} controls src={videoUrl} autoPlay loop />
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </section>
  );
}
