'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, FileAudio, FileText, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './ImportUploader.module.css';

interface ImportUploaderProps {
  onImportStarted: (podcastId: string) => void;
}

const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB
const ACCEPTED_AUDIO = 'audio/*';
const ACCEPTED_TRANSCRIPT = '.srt,.vtt,.txt';

export function ImportUploader({ onImportStarted }: ImportUploaderProps) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [isHumanContent, setIsHumanContent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);

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
    const audioFile = files.find((f) => f.type.startsWith('audio/'));

    if (audioFile) {
      if (audioFile.size > MAX_AUDIO_SIZE) {
        setError(`Audio file too large. Maximum size is 100MB.`);
        return;
      }
      setAudioFile(audioFile);
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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!title.trim()) {
        setError('Please enter a title');
        return;
      }
      if (!topic.trim()) {
        setError('Please enter a description');
        return;
      }
      if (!audioFile) {
        setError('Please select an audio file');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('title', title.trim());
        formData.append('topic', topic.trim());
        formData.append('audio', audioFile);
        formData.append('isHumanContent', String(isHumanContent));

        if (transcriptFile) {
          formData.append('transcript', transcriptFile);
        }

        const response = await fetch('/api/podcasts/import', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to import podcast');
        }

        const podcast = await response.json();
        onImportStarted(podcast.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setLoading(false);
      }
    },
    [title, topic, audioFile, transcriptFile, isHumanContent, onImportStarted]
  );

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

      <div className={styles.field}>
        <label htmlFor="title" className={styles.label}>
          Title <span className={styles.required}>*</span>
        </label>
        <input
          id="title"
          type="text"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter podcast title"
          disabled={loading}
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="topic" className={styles.label}>
          Description <span className={styles.required}>*</span>
        </label>
        <textarea
          id="topic"
          className={styles.textarea}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What is this podcast about?"
          rows={4}
          disabled={loading}
          required
        />
      </div>

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
            disabled={loading}
          />
          <span className={styles.toggleSwitch} aria-hidden="true" />
          <span className={styles.toggleText}>
            This is a human-made podcast
            <span className={styles.toggleHint}>
              Check this if the content was created by humans, not AI
            </span>
          </span>
        </label>
      </div>

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          size="large"
          fullWidth
          loading={loading}
          disabled={loading || !audioFile || !title.trim() || !topic.trim()}
        >
          {loading ? 'Importing...' : 'Import Podcast'}
        </Button>
      </div>
    </form>
  );
}
