'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, FileAudio, FileText, X, AlertCircle, ChevronDown, Info } from 'lucide-react';
import { SOURCE_PLATFORMS, SOURCE_PLATFORM_HELP } from '@sotto/shared';
import type { SourcePlatformValue } from '@sotto/shared';
import { Button } from '@/components/ui/Button';
import { SttModelDropdown } from '@/components/create/SttModelDropdown';
import styles from './ImportUploader.module.css';

interface ImportUploaderProps {
  onImportStarted: (podcastId: string) => void;
  draftId?: string;
  initialImportData?: {
    title?: string;
    topic?: string;
    sourcePlatform?: string;
    isHumanContent?: boolean;
    sttProvider?: string;
  };
  onDraftCreated?: (id: string) => void;
}

const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB
const ACCEPTED_AUDIO = 'audio/*';
const ACCEPTED_TRANSCRIPT = '.srt,.vtt,.txt';

export function ImportUploader({ onImportStarted, draftId: initialDraftId, initialImportData, onDraftCreated }: ImportUploaderProps) {
  const [title, setTitle] = useState(initialImportData?.title ?? '');
  const [topic, setTopic] = useState(initialImportData?.topic ?? '');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [sourcePlatform, setSourcePlatform] = useState(initialImportData?.sourcePlatform ?? '');
  const [customPlatform, setCustomPlatform] = useState('');
  const [isHumanContent, setIsHumanContent] = useState(initialImportData?.isHumanContent ?? false);
  const [sttProvider, setSttProvider] = useState<string | undefined>(initialImportData?.sttProvider);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const draftIdRef = useRef<string | null>(initialDraftId ?? null);
  const creatingDraftRef = useRef(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const dropped = files.find((f) => f.type.startsWith('audio/'));

    if (dropped) {
      if (dropped.size > MAX_AUDIO_SIZE) {
        setError(`Audio file too large. Maximum size is 100MB.`);
        return;
      }
      setAudioFile(dropped);
      setError(null);
    }
  }, []);

  const handleAudioSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_AUDIO_SIZE) {
        setError(`Audio file too large. Maximum size is 100MB.`);
        return;
      }
      setAudioFile(file);
      setError(null);
    }
  }, []);

  const handleTranscriptSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTranscriptFile(file);
    }
  }, []);

  // Create draft when audio + platform are set
  const tryCreateDraft = useCallback(() => {
    if (draftIdRef.current || creatingDraftRef.current || !audioFile || !sourcePlatform) return;
    creatingDraftRef.current = true;
    const resolvedPlatform = sourcePlatform === 'other' ? customPlatform.trim() : sourcePlatform;
    fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabMode: 'import',
        importData: {
          title: title.trim() || undefined,
          topic: topic.trim() || undefined,
          sourcePlatform: resolvedPlatform || undefined,
          isHumanContent,
          sttProvider,
        },
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.id) {
          draftIdRef.current = data.id;
          setDraftId(data.id);
          onDraftCreated?.(data.id);
        }
      })
      .catch((err) => console.warn('[sotto] import draft save failed', err))
      .finally(() => {
        creatingDraftRef.current = false;
      });
  }, [audioFile, sourcePlatform, customPlatform, title, topic, isHumanContent, sttProvider, onDraftCreated]);

  // Trigger draft creation when audio + platform are set
  useEffect(() => {
    if (audioFile && sourcePlatform) {
      tryCreateDraft();
    }
  }, [audioFile, sourcePlatform, tryCreateDraft]);

  // Debounced save of form changes to existing draft
  useEffect(() => {
    if (!draftId) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    const resolvedPlatform = sourcePlatform === 'other' ? customPlatform.trim() : sourcePlatform;
    draftSaveTimerRef.current = setTimeout(() => {
      fetch(`/api/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftData: {
            tabMode: 'import',
            importData: {
              title: title.trim() || undefined,
              topic: topic.trim() || undefined,
              sourcePlatform: resolvedPlatform || undefined,
              isHumanContent,
              sttProvider,
            },
          },
        }),
      }).catch((err) => console.warn('[sotto] import draft save failed', err));
    }, 2000);
  }, [draftId, title, topic, sourcePlatform, customPlatform, isHumanContent, sttProvider]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!audioFile) {
        setError('Please select an audio file');
        return;
      }

      const resolvedPlatform = sourcePlatform === 'other' ? customPlatform.trim() : sourcePlatform;
      if (!resolvedPlatform) {
        setError('Please select a source platform');
        return;
      }

      setLoading(true);
      setUploadProgress(0);
      setError(null);

      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('isHumanContent', String(isHumanContent));

      if (title.trim()) {
        formData.append('title', title.trim());
      }
      if (topic.trim()) {
        formData.append('topic', topic.trim());
      }
      formData.append('sourcePlatform', resolvedPlatform);
      if (sttProvider) {
        formData.append('sttProvider', sttProvider);
      }
      if (transcriptFile) {
        formData.append('transcript', transcriptFile);
      }
      if (draftIdRef.current) {
        formData.append('draftId', draftIdRef.current);
      }

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        xhrRef.current = null;
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            onImportStarted(data.id);
          } else {
            setError(data.error || 'Failed to import podcast');
            setLoading(false);
            setUploadProgress(0);
          }
        } catch {
          setError('Failed to import podcast');
          setLoading(false);
          setUploadProgress(0);
        }
      });

      xhr.addEventListener('error', () => {
        xhrRef.current = null;
        setError('Network error — please check your connection and try again');
        setLoading(false);
        setUploadProgress(0);
      });

      xhr.addEventListener('abort', () => {
        xhrRef.current = null;
        setLoading(false);
        setUploadProgress(0);
      });

      xhr.open('POST', '/api/podcasts/import');
      xhr.send(formData);
    },
    [title, topic, audioFile, transcriptFile, isHumanContent, sourcePlatform, customPlatform, sttProvider, onImportStarted]
  );

  const handleCancel = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
    }
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {error && (
        <div className={styles.error} role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <p>{error}</p>
          <button
            type="button"
            className={styles.errorDismiss}
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {initialImportData && !audioFile && (
        <div className={styles.info} role="status">
          <Info size={18} aria-hidden="true" />
          <p>Re-select your audio file to continue where you left off.</p>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label}>
          Audio File <span className={styles.required}>*</span>
        </label>
        <div
          className={`${styles.dropzone} ${isDragging ? styles.dropzoneDragging : ''} ${audioFile ? styles.dropzoneHasFile : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => audioInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label={
            audioFile ? `Selected: ${audioFile.name}` : 'Click or drag to upload audio file'
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              audioInputRef.current?.click();
            }
          }}
        >
          <input
            ref={audioInputRef}
            type="file"
            accept={ACCEPTED_AUDIO}
            onChange={handleAudioSelect}
            className={styles.hiddenInput}
            disabled={loading}
            aria-label="Audio file upload"
          />

          {audioFile ? (
            <div className={styles.filePreview}>
              <div className={styles.fileIcon}>
                <FileAudio size={32} strokeWidth={1.5} />
              </div>
              <div className={styles.fileInfo}>
                <p className={styles.fileName}>{audioFile.name}</p>
                <p className={styles.fileSize}>{formatFileSize(audioFile.size)}</p>
              </div>
              {!loading && (
                <button
                  type="button"
                  className={styles.fileRemove}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAudioFile(null);
                  }}
                  aria-label="Remove audio file"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ) : (
            <div className={styles.dropzoneContent}>
              <div className={styles.uploadIcon}>
                <Upload size={40} strokeWidth={1.5} />
              </div>
              <p className={styles.dropzoneText}>
                <span className={styles.dropzoneTextPrimary}>Click to browse</span>
                <span className={styles.dropzoneTextSecondary}>or drag and drop</span>
              </p>
              <p className={styles.dropzoneHint}>MP3, WAV, M4A, or any audio format (max 100MB)</p>
            </div>
          )}
        </div>
      </div>

      <SttModelDropdown value={sttProvider} onChange={setSttProvider} />

      <div className={styles.field}>
        <label htmlFor="title" className={styles.label}>
          Title
        </label>
        <input
          id="title"
          type="text"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter podcast title"
          disabled={loading}
        />
        <span className={styles.fieldHint}>Auto-generated from transcript if left blank</span>
      </div>

      <div className={styles.field}>
        <label htmlFor="topic" className={styles.label}>
          Description
        </label>
        <textarea
          id="topic"
          className={styles.textarea}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What is this podcast about?"
          rows={3}
          disabled={loading}
        />
        <span className={styles.fieldHint}>Auto-generated from transcript if left blank</span>
      </div>

      <div className={styles.field}>
        <label htmlFor="sourcePlatform" className={styles.label}>
          Source Platform <span className={styles.required}>*</span>
        </label>
        <div className={styles.selectWrapper}>
          <select
            id="sourcePlatform"
            className={styles.select}
            value={sourcePlatform}
            onChange={(e) => {
              const value = e.target.value;
              setSourcePlatform(value);
              if (value !== 'other') {
                setCustomPlatform('');
              }
              const platform = SOURCE_PLATFORMS.find((p) => p.value === value);
              if (platform?.isAiGenerated) {
                setIsHumanContent(false);
              }
            }}
            disabled={loading}
            required
          >
            <option value="">Select a platform</option>
            {SOURCE_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} className={styles.selectIcon} aria-hidden="true" />
        </div>
        {sourcePlatform === 'other' && (
          <input
            id="customPlatform"
            type="text"
            className={styles.input}
            value={customPlatform}
            onChange={(e) => setCustomPlatform(e.target.value)}
            placeholder="Enter platform name"
            disabled={loading}
            required
            autoFocus
          />
        )}
        {sourcePlatform &&
          sourcePlatform !== 'other' &&
          SOURCE_PLATFORM_HELP[sourcePlatform as SourcePlatformValue] && (
            <div className={styles.platformHelp}>
              <Info size={16} aria-hidden="true" />
              <p>{SOURCE_PLATFORM_HELP[sourcePlatform as SourcePlatformValue]}</p>
            </div>
          )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Transcript (Optional)</label>
        <div className={styles.transcriptUpload}>
          <input
            ref={transcriptInputRef}
            type="file"
            accept={ACCEPTED_TRANSCRIPT}
            onChange={handleTranscriptSelect}
            className={styles.hiddenInput}
            disabled={loading}
            aria-label="Transcript file upload"
          />

          {transcriptFile ? (
            <div className={styles.transcriptPreview}>
              <FileText size={18} />
              <span className={styles.transcriptName}>{transcriptFile.name}</span>
              {!loading && (
                <button
                  type="button"
                  className={styles.transcriptRemove}
                  onClick={() => setTranscriptFile(null)}
                  aria-label="Remove transcript"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className={styles.transcriptButton}
              onClick={() => transcriptInputRef.current?.click()}
              disabled={loading}
            >
              <FileText size={18} />
              Upload Transcript (.srt, .vtt, .txt)
            </button>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={isHumanContent}
            onChange={(e) => setIsHumanContent(e.target.checked)}
            className={styles.checkbox}
            disabled={
              loading ||
              SOURCE_PLATFORMS.some((p) => p.value === sourcePlatform && p.isAiGenerated)
            }
          />
          <span className={styles.toggleSwitch} aria-hidden="true" />
          <span className={styles.toggleText}>
            This is a human-made podcast
            <span className={styles.toggleHint}>
              Check this if the content was created by humans, not AI
            </span>
          </span>
        </label>
        {isHumanContent && (
          <div className={styles.attestation}>
            <span className={styles.attestationIcon} aria-hidden="true">!</span>
            <p className={styles.attestationText}>
              By checking this, you confirm this podcast was created by humans, not generated by AI.
              False claims may result in badge removal and account action.
            </p>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {loading && uploadProgress < 100 ? (
          <div className={styles.progressContainer}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Uploading...</span>
              <span className={styles.progressPercent}>{uploadProgress}%</span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        ) : loading ? (
          <div className={styles.progressContainer}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Processing...</span>
            </div>
            <div className={styles.progressTrack}>
              <div className={`${styles.progressFill} ${styles.progressIndeterminate}`} />
            </div>
          </div>
        ) : (
          <Button
            type="submit"
            variant="primary"
            size="large"
            fullWidth
            disabled={!audioFile || !sourcePlatform || (sourcePlatform === 'other' && !customPlatform.trim())}
          >
            Import Podcast
          </Button>
        )}
      </div>
    </form>
  );
}
