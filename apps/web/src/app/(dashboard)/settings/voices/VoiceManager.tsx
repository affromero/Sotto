'use client';

import { useEffect, useState, useRef } from 'react';
import styles from './VoiceManager.module.css';
import { VoiceVerificationChallenge } from '@/components/settings/VoiceVerificationChallenge';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';

interface VoiceClone {
  id: string;
  name: string;
  provider: string;
  description: string | null;
  externalVoiceId: string;
  sourceType: 'UPLOAD' | 'RECORD' | 'IMPORT';
  verificationStatus: string;
  createdAt: string;
}

export function VoiceManager() {
  const [userClones, setUserClones] = useState<VoiceClone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [verifyingVoice, setVerifyingVoice] = useState<VoiceClone | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [inputTab, setInputTab] = useState<'upload' | 'record' | 'import'>('upload');
  const [cloneProvider, setCloneProvider] = useState<'elevenlabs' | 'cartesia' | 'hume'>('elevenlabs');
  const [humeVoiceId, setHumeVoiceId] = useState('');
  const [humeName, setHumeName] = useState('');
  const [importingHume, setImportingHume] = useState(false);
  const [elImportVoiceId, setElImportVoiceId] = useState('');
  const [importingEl, setImportingEl] = useState(false);
  const [previewText, setPreviewText] = useState('Hello! This is a quick preview of this voice on Sotto.');
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorder = useAudioRecorder({ maxSeconds: 60, minSeconds: 5 });

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
      setUserClones(voiceData.userClones ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }


  async function handleClone(e: React.FormEvent) {
    e.preventDefault();
    const isRecord = inputTab === 'record';
    if (isRecord && !recorder.recordedBlob) return;
    if (!isRecord && !cloneFile) return;
    if (!cloneName.trim()) return;

    try {
      setCloning(true);
      setError(null);

      const formData = new FormData();
      if (isRecord && recorder.recordedBlob) {
        const ext = recorder.mimeType?.includes('webm') ? 'webm' : 'm4a';
        formData.append('audio', recorder.recordedBlob, `recording.${ext}`);
        formData.append('sourceType', 'RECORD');
      } else if (cloneFile) {
        formData.append('audio', cloneFile);
        formData.append('sourceType', 'UPLOAD');
      }
      formData.append('name', cloneName.trim());
      formData.append('provider', cloneProvider);

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
      recorder.reset();
      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone voice');
    } finally {
      setCloning(false);
    }
  }

  async function handleImportHume(e: React.FormEvent) {
    e.preventDefault();
    if (!humeName.trim() || !humeVoiceId.trim()) return;

    try {
      setImportingHume(true);
      setError(null);

      const formData = new FormData();
      formData.append('name', humeName.trim());
      formData.append('provider', 'hume');
      formData.append('externalVoiceId', humeVoiceId.trim());
      formData.append('sourceType', 'IMPORT');

      const response = await fetch('/api/voices/clone', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to import voice');
      }

      setHumeName('');
      setHumeVoiceId('');
      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import voice');
    } finally {
      setImportingHume(false);
    }
  }

  async function handleImportElevenLabs(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = elImportVoiceId.trim();
    if (!trimmed) return;
    setImportingEl(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('provider', 'elevenlabs');
      fd.append('sourceType', 'IMPORT');
      fd.append('externalVoiceId', trimmed);
      const res = await fetch('/api/voices/clone', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import voice');
      setElImportVoiceId('');
      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import voice');
    } finally {
      setImportingEl(false);
    }
  }

  async function handlePreviewById(voiceId: string, provider: string) {
    const trimmedId = voiceId.trim();
    const trimmedText = previewText.trim();
    if (!trimmedId || !trimmedText) return;
    setPreviewing(true);
    setError(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    try {
      const res = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: trimmedId, text: trimmedText, provider }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Preview failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPreviewing(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPreviewing(false); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (err) {
      setPreviewing(false);
      setError(err instanceof Error ? err.message : 'Preview failed');
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

  async function handlePlayPreview(externalVoiceId: string, provider: string) {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setPlaying(externalVoiceId);
      setError(null);

      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: externalVoiceId,
          text: 'Hello, this is a preview of my cloned voice on Sotto.',
          provider,
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

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Voice Management</h2>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Cloned Voices</h3>

        {userClones.length === 0 ? (
          <p className={styles.empty}>
            No cloned voices yet. Upload an audio sample to create your first custom voice.
          </p>
        ) : (
          <div className={styles.voiceList}>
            {userClones.map((voice) => (
              <div key={voice.id} className={styles.voiceItemWrap}>
                <div className={styles.voiceItem}>
                  <div>
                    <div className={styles.voiceNameRow}>
                      <div className={styles.voiceName}>{voice.name}</div>
                      {(voice.verificationStatus === 'VERIFIED' || voice.verificationStatus === 'ADMIN_VERIFIED') && (
                        <span className={styles.verifiedBadge} title="Verified">
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                            <circle cx="7" cy="7" r="7" fill="#16a34a" />
                            <path d="M4 7l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Verified
                        </span>
                      )}
                      {voice.verificationStatus === 'PROTECTED' && (
                        <span className={styles.protectedBadge} title="Protected">
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                            <path d="M7 1L2 3.5v4C2 10.5 4 12.5 7 13c3-.5 5-2.5 5-5.5v-4L7 1z" fill="var(--color-accent)" />
                            <path d="M5 7l1.5 1.5L9.5 5" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Protected
                        </span>
                      )}
                      {(voice.verificationStatus === 'PENDING_VERIFICATION' || voice.verificationStatus === 'CHALLENGE_SUBMITTED') && (
                        <span className={styles.pendingBadge}>
                          <span className={styles.spinnerTiny} /> Processing...
                        </span>
                      )}
                      {voice.verificationStatus === 'AWAITING_CHALLENGE' && (
                        <button
                          type="button"
                          className={styles.verifyBtn}
                          onClick={() => setVerifyingVoice(voice)}
                        >
                          Verify Now
                        </button>
                      )}
                      {voice.verificationStatus === 'BLOCKED' && (
                        <span className={styles.blockedBadge} title="Blocked — matches an existing verified voice">
                          Blocked
                        </span>
                      )}
                      {voice.verificationStatus === 'REJECTED' && (
                        <span className={styles.rejectedBadge} title="Failed verification">
                          Rejected
                        </span>
                      )}
                    </div>
                    <div className={styles.voiceMeta}>
                      <span
                        className={`${styles.voiceBadge} ${voice.sourceType === 'RECORD' ? styles.badgeRecord : styles.badgeUpload}`}
                      >
                        {voice.sourceType}
                      </span>
                      <span className={styles.voiceDate}>{formatDate(voice.createdAt)}</span>
                    </div>
                  </div>
                  <div className={styles.voiceActions}>
                    <button
                      type="button"
                      className={styles.playButton}
                      onClick={() => handlePlayPreview(voice.externalVoiceId, voice.provider)}
                      disabled={playing === voice.externalVoiceId}
                      aria-label={`Preview ${voice.name}`}
                    >
                      {playing === voice.externalVoiceId ? (
                        <span className={styles.spinnerSmall} />
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
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
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M2 4h12M5.5 4V2.5h5V4M6.5 7v4M9.5 7v4M3.5 4l.5 9.5h8l.5-9.5" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Add New Voice</h3>

        <div className={styles.providerPills} role="tablist" aria-label="Voice provider">
          {(['elevenlabs', 'cartesia', 'hume'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={cloneProvider === p}
              className={`${styles.pill} ${cloneProvider === p ? styles.pillActive : ''}`}
              onClick={() => setCloneProvider(p)}
              disabled={cloning || importingHume}
            >
              {p === 'elevenlabs' ? 'ElevenLabs' : p === 'cartesia' ? 'Cartesia' : 'Hume'}
            </button>
          ))}
        </div>

        {cloneProvider === 'hume' ? (
          <form onSubmit={handleImportHume} className={styles.uploadForm}>
            <p className={styles.hint}>
              Paste a Hume custom voice ID to import it. No audio upload needed.
            </p>
            <div className={styles.formGroup}>
              <label htmlFor="hume-name" className={styles.label}>
                Voice Name
              </label>
              <input
                id="hume-name"
                type="text"
                className={styles.nameInput}
                value={humeName}
                onChange={(e) => setHumeName(e.target.value)}
                placeholder="My Hume Voice"
                required
                disabled={importingHume}
                maxLength={100}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="hume-voice-id" className={styles.label}>
                Hume Voice ID
              </label>
              <input
                id="hume-voice-id"
                type="text"
                className={styles.nameInput}
                value={humeVoiceId}
                onChange={(e) => setHumeVoiceId(e.target.value)}
                placeholder="e.g. 9e068547-5ba4-..."
                required
                disabled={importingHume}
                maxLength={200}
              />
            </div>
            <button
              type="submit"
              className={styles.cloneButton}
              disabled={importingHume || !humeName.trim() || !humeVoiceId.trim()}
            >
              {importingHume ? (
                <>
                  <span className={styles.spinnerSmall} /> Importing...
                </>
              ) : (
                'Import Voice'
              )}
            </button>
          </form>
        ) : (
        <form onSubmit={inputTab === 'import' ? handleImportElevenLabs : handleClone} className={styles.uploadForm}>
          {inputTab !== 'import' && (
            <div className={styles.formGroup}>
              <label htmlFor="voice-name" className={styles.label}>
                Voice Name
              </label>
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
          )}

          <div className={styles.inputTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={inputTab === 'upload'}
              className={`${styles.inputTab} ${inputTab === 'upload' ? styles.inputTabActive : ''}`}
              onClick={() => setInputTab('upload')}
              disabled={cloning || recorder.isRecording}
            >
              Upload File
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputTab === 'record'}
              className={`${styles.inputTab} ${inputTab === 'record' ? styles.inputTabActive : ''}`}
              onClick={() => setInputTab('record')}
              disabled={cloning}
            >
              Record Mic
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputTab === 'import'}
              className={`${styles.inputTab} ${inputTab === 'import' ? styles.inputTabActive : ''}`}
              onClick={() => setInputTab('import')}
              disabled={cloning}
            >
              Voice ID
            </button>
          </div>

          {inputTab === 'import' ? (
            <div className={styles.importIdSection}>
              <div className={styles.formGroup}>
                <label htmlFor="el-voice-id" className={styles.label}>
                  ElevenLabs Voice ID
                </label>
                <input
                  id="el-voice-id"
                  type="text"
                  className={styles.nameInput}
                  value={elImportVoiceId}
                  onChange={(e) => setElImportVoiceId(e.target.value)}
                  placeholder="e.g. pNInz6obpgDQGcFmaJgB"
                  required
                  disabled={importingEl}
                  maxLength={200}
                />
                <p className={styles.hint}>
                  Paste any ElevenLabs voice ID. The name is fetched automatically.
                </p>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="preview-text" className={styles.label}>
                  Preview text
                </label>
                <div className={styles.previewRow}>
                  <input
                    id="preview-text"
                    type="text"
                    className={styles.nameInput}
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    placeholder="Type something to hear this voice…"
                    maxLength={300}
                    disabled={previewing}
                  />
                  <button
                    type="button"
                    className={styles.previewButton}
                    onClick={() => handlePreviewById(elImportVoiceId, 'elevenlabs')}
                    disabled={previewing || !elImportVoiceId.trim() || !previewText.trim()}
                    aria-label="Preview voice"
                  >
                    {previewing ? <span className={styles.spinnerSmall} /> : '▶'}
                  </button>
                </div>
              </div>
            </div>
          ) : inputTab === 'upload' ? (
            <div className={styles.formGroup}>
              <label htmlFor="voice-file" className={styles.label}>
                Audio Sample
              </label>
              <input
                id="voice-file"
                type="file"
                className={styles.fileInput}
                accept="audio/*"
                onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
                required
                disabled={cloning}
              />
              <p className={styles.hint}>
                Upload a clear recording (MP3, WAV, M4A). At least 30 seconds for best results.
              </p>
            </div>
          ) : (
            <div className={styles.recorderSection}>
              {recorder.error && (
                <div className={styles.error} role="alert">{recorder.error}</div>
              )}

              {!recorder.isRecording && !recorder.recordedBlob && (
                <button
                  type="button"
                  className={styles.recordButton}
                  onClick={recorder.startRecording}
                  disabled={cloning}
                  aria-label="Start recording"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <circle cx="10" cy="10" r="6" />
                  </svg>
                  Start Recording
                </button>
              )}

              {recorder.isRecording && (
                <div className={styles.recorderSection}>
                  <div className={styles.recordTimer}>
                    <span className={styles.recordButtonRecording} aria-hidden="true" />
                    Recording... {recorder.duration}s
                    {recorder.duration < recorder.minSeconds && (
                      <span className={styles.hint}> (min {recorder.minSeconds}s)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.cloneButton}
                    onClick={recorder.stopRecording}
                    disabled={recorder.duration < recorder.minSeconds}
                  >
                    Stop
                  </button>
                </div>
              )}

              {!recorder.isRecording && recorder.recordedBlob && (
                <div className={styles.recordPreview}>
                  <button type="button" className={styles.inputTab} onClick={recorder.playPreview}>
                    Play Preview
                  </button>
                  <button type="button" className={styles.inputTab} onClick={recorder.reset}>
                    Re-record
                  </button>
                  <span className={styles.hint}>{recorder.duration}s recorded</span>
                </div>
              )}

              <p className={styles.hint}>
                Record a clear voice sample. At least 30 seconds for best results.
              </p>
            </div>
          )}

          <button
            type="submit"
            className={styles.cloneButton}
            disabled={
              inputTab === 'import'
                ? importingEl || !elImportVoiceId.trim()
                : cloning || !cloneName.trim() || (inputTab === 'upload' ? !cloneFile : !recorder.recordedBlob)
            }
          >
            {inputTab === 'import' ? (
              importingEl ? (
                <><span className={styles.spinnerSmall} /> Importing…</>
              ) : (
                'Import Voice'
              )
            ) : cloning ? (
              <><span className={styles.spinnerSmall} /> Cloning…</>
            ) : (
              'Clone Voice'
            )}
          </button>
        </form>
        )}
      </section>

      {verifyingVoice && (
        <VoiceVerificationChallenge
          voiceCloneId={verifyingVoice.id}
          voiceName={verifyingVoice.name}
          onVerified={() => {
            setVerifyingVoice(null);
            fetchVoices();
          }}
          onClose={() => setVerifyingVoice(null)}
        />
      )}
    </div>
  );
}
