'use client';

import { useCallback, useState } from 'react';
import styles from './LipSyncTester.module.css';

const DEFAULT_PROMPT = 'Welcome to Sotto. Let me tell you something fascinating today.';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — stable ElevenLabs voice

const LIP_SYNC_MODELS = [
  { id: 'fal-veed-fabric-1.0', name: 'VEED Fabric 1.0', disabled: false },
  { id: 'fal-kling-avatar-v2-pro', name: 'Kling Avatar v2 Pro', disabled: false },
  { id: 'runway-characters', name: 'Runway Characters', disabled: true, reason: 'Not ready — conversational AI only' },
];

type Stage = 'idle' | 'generating-audio' | 'audio-ready' | 'generating-video' | 'video-ready' | 'error';

export function LipSyncTester() {
  const [stage, setStage] = useState<Stage>('idle');
  const [textPrompt, setTextPrompt] = useState(DEFAULT_PROMPT);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [avatarImageUrl, setAvatarImageUrl] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState(LIP_SYNC_MODELS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);

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
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setStage('audio-ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio generation failed');
      setStage('error');
    }
  }, [textPrompt]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setGeneratingImage(false);
    }
  }, [imagePrompt]);

  const generateVideo = useCallback(async () => {
    if (!audioUrl || !avatarImageUrl) return;

    setStage('generating-video');
    setError(null);
    setVideoUrl(null);

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

      // Poll for completion
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));

        const pollRes = await fetch(`/api/avatar-test?jobId=${jobId}`);
        if (!pollRes.ok) continue;

        const status = await pollRes.json();

        if (status.status === 'completed' && status.videoUrl) {
          setVideoUrl(status.videoUrl);
          setStage('video-ready');
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
  }, [audioUrl, avatarImageUrl, selectedModel]);

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
            disabled={isGenerating}
          >
            {LIP_SYNC_MODELS.map((m) => (
              <option key={m.id} value={m.id} disabled={m.disabled}>
                {m.name}{m.disabled ? ` (${m.reason})` : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={generateVideo}
          disabled={!audioUrl || !avatarImageUrl || isGenerating}
        >
          {stage === 'generating-video' ? 'Generating Video...' : 'Generate Video'}
        </button>

        {stage === 'generating-video' && (
          <div className={styles.status}>
            <span className={styles.spinner} />
            Processing lip-sync...
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
