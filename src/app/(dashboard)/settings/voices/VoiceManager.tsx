'use client';

import { useEffect, useState, useRef } from 'react';
import styles from './VoiceManager.module.css';

interface VoiceClone {
  id: string;
  name: string;
  elevenLabsVoiceId: string;
  sourceType: 'UPLOAD' | 'RECORD';
  createdAt: string;
}

interface VoiceCredits {
  used: number;
  total: number;
  remaining: number;
}

interface VoiceData {
  userClones: VoiceClone[];
  credits: VoiceCredits;
}

export function VoiceManager() {
  const [data, setData] = useState<VoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchVoices();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  async function fetchVoices() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/voices');
      if (!response.ok) throw new Error('Failed to fetch voices');
      const voiceData = await response.json();
      setData(voiceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }

  async function handleClone(e: React.FormEvent) {
    e.preventDefault();
    if (!cloneFile || !cloneName.trim()) return;

    try {
      setCloning(true);
      setError(null);

      const formData = new FormData();
      formData.append('audio', cloneFile);
      formData.append('name', cloneName.trim());
      formData.append('sourceType', 'UPLOAD');

      const response = await fetch('/api/voices/clone', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to clone voice');
      }

      setCloneName('');
      setCloneFile(null);
      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone voice');
    } finally {
      setCloning(false);
    }
  }

  async function handleDelete(voiceCloneId: string) {
    try {
      setDeleting(voiceCloneId);
      setError(null);

      const response = await fetch('/api/voices/clone', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete voice');
      }

      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete voice');
    } finally {
      setDeleting(null);
    }
  }

  async function handlePlayPreview(elevenLabsVoiceId: string) {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setPlaying(elevenLabsVoiceId);
      setError(null);

      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: elevenLabsVoiceId,
          text: 'Hello, this is a preview of my cloned voice on Sotto.',
        }),
      });

      if (!response.ok) throw new Error('Failed to generate preview');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setPlaying(null);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onerror = () => {
        setPlaying(null);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (err) {
      setPlaying(null);
      setError(err instanceof Error ? err.message : 'Failed to play preview');
    }
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingWrap}>
          <span className={styles.spinner} />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <p className={styles.error}>Failed to load voice data</p>
      </div>
    );
  }

  const creditPct = data.credits.total > 0
    ? Math.min((data.credits.used / data.credits.total) * 100, 100)
    : 0;
  const isFree = data.credits.total === 0;

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Voice Management</h2>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Premium Voice Credits</h3>
        <div className={styles.creditLabel}>
          {data.credits.used} / {data.credits.total} used this month
        </div>
        <div className={styles.creditBar} role="progressbar" aria-valuenow={data.credits.used} aria-valuemax={data.credits.total}>
          <div className={styles.creditBarFill} style={{ width: `${creditPct}%` }} />
        </div>
        {data.credits.remaining === 0 && data.credits.total > 0 && (
          <p className={styles.hint}>All credits used this month. Credits reset at the start of your next billing period.</p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Cloned Voices</h3>

        {data.userClones.length === 0 ? (
          <p className={styles.empty}>
            {isFree
              ? 'Voice cloning is available on Pro and Creator plans.'
              : 'No cloned voices yet. Upload an audio sample to create your first custom voice.'}
          </p>
        ) : (
          <div className={styles.voiceList}>
            {data.userClones.map((voice) => (
              <div key={voice.id} className={styles.voiceItem}>
                <div>
                  <div className={styles.voiceName}>{voice.name}</div>
                  <div className={styles.voiceMeta}>
                    <span className={`${styles.voiceBadge} ${voice.sourceType === 'RECORD' ? styles.badgeRecord : styles.badgeUpload}`}>
                      {voice.sourceType}
                    </span>
                    <span className={styles.voiceDate}>{formatDate(voice.createdAt)}</span>
                  </div>
                </div>
                <div className={styles.voiceActions}>
                  <button
                    type="button"
                    className={styles.playButton}
                    onClick={() => handlePlayPreview(voice.elevenLabsVoiceId)}
                    disabled={playing === voice.elevenLabsVoiceId}
                    aria-label={`Preview ${voice.name}`}
                  >
                    {playing === voice.elevenLabsVoiceId ? (
                      <span className={styles.spinnerSmall} />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M4 2.5v11l9-5.5L4 2.5z" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => handleDelete(voice.id)}
                    disabled={deleting === voice.id}
                    aria-label={`Delete ${voice.name}`}
                  >
                    {deleting === voice.id ? (
                      <span className={styles.spinnerSmall} />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                        <path d="M2 4h12M5.5 4V2.5h5V4M6.5 7v4M9.5 7v4M3.5 4l.5 9.5h8l.5-9.5" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Add New Voice</h3>
        {isFree ? (
          <div className={styles.upgradeBanner}>
            <p>Voice cloning requires a paid subscription. Upgrade to clone your own voice for podcasts.</p>
            <a href="/pricing" className={styles.upgradeButton}>View Plans</a>
          </div>
        ) : (
          <form onSubmit={handleClone} className={styles.uploadForm}>
            <div className={styles.formGroup}>
              <label htmlFor="voice-name" className={styles.label}>Voice Name</label>
              <input
                id="voice-name"
                type="text"
                className={styles.nameInput}
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="My Voice"
                required
                disabled={cloning}
                maxLength={100}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="voice-file" className={styles.label}>Audio Sample</label>
              <input
                id="voice-file"
                type="file"
                className={styles.fileInput}
                accept="audio/*"
                onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
                required
                disabled={cloning}
              />
              <p className={styles.hint}>Upload a clear recording (MP3, WAV, M4A). At least 30 seconds for best results.</p>
            </div>
            <button
              type="submit"
              className={styles.cloneButton}
              disabled={cloning || !cloneName.trim() || !cloneFile}
            >
              {cloning ? (
                <>
                  <span className={styles.spinnerSmall} />
                  Cloning...
                </>
              ) : (
                'Clone Voice'
              )}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
