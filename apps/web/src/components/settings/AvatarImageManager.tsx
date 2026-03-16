'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './AvatarImageManager.module.css';

interface AvatarImage {
  id: string;
  name: string;
  imageUrl: string;
  sourceType: 'UPLOAD' | 'GENERATED';
}

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function AvatarImageManager() {
  const [images, setImages] = useState<AvatarImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch('/api/avatar-images');
      if (!res.ok) throw new Error('Failed to load images');
      const data = await res.json();
      setImages(data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Invalid file type. Only JPEG, PNG, and WebP are allowed.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File too large. Maximum size is 5MB.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('name', file.name.replace(/\.[^.]+$/, ''));

      const res = await fetch('/api/avatar-images', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `Upload failed (${res.status})`);
      }

      await fetchImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [fetchImages]);

  const handleGenerate = useCallback(async () => {
    if (!generatePrompt.trim()) return;

    setGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/avatar-images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `generated-${Date.now()}`, prompt: generatePrompt }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `Generation failed (${res.status})`);
      }

      setGeneratePrompt('');
      await fetchImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [generatePrompt, fetchImages]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this avatar image?')) return;

    setDeletingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/avatar-images/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `Delete failed (${res.status})`);
      }

      setImages((prev) => prev.filter((img) => img.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }, []);

  const atLimit = images.length >= MAX_IMAGES;

  if (loading) {
    return <div className={styles.root}><p className={styles.status}>Loading images...</p></div>;
  }

  return (
    <div className={styles.root} id="avatar-images">
      <div className={styles.header}>
        <span className={`${styles.count} ${atLimit ? styles.countFull : ''}`}>
          {images.length}/{MAX_IMAGES} images
        </span>
      </div>

      {images.length === 0 ? (
        <p className={styles.empty}>
          No avatar images yet. Upload a portrait photo or generate one to use with lip-sync models like Kling and VEED.
        </p>
      ) : (
        <div className={styles.grid}>
          {images.map((img) => (
            <div key={img.id} className={styles.card}>
              <img src={img.imageUrl} alt={img.name} className={styles.cardImage} />
              <span className={styles.cardName}>{img.name}</span>
              <span className={styles.cardSource}>{img.sourceType === 'GENERATED' ? 'Generated' : 'Uploaded'}</span>
              <button
                className={styles.deleteBtn}
                onClick={() => handleDelete(img.id)}
                disabled={deletingId === img.id}
                aria-label={`Delete ${img.name}`}
              >
                {deletingId === img.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <label className={`${styles.uploadLabel} ${atLimit ? styles.uploadLabelDisabled : ''}`}>
          {uploading ? 'Uploading...' : 'Upload Image'}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleUpload}
            disabled={atLimit || uploading}
            className={styles.hiddenInput}
          />
        </label>
      </div>

      <div className={styles.generateRow}>
        <div className={styles.generateField}>
          <label className={styles.generateLabel}>Generate from prompt</label>
          <input
            className={styles.generateInput}
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            placeholder="Professional portrait, female, warm smile..."
            disabled={atLimit || generating}
          />
        </div>
        <button
          className={styles.generateBtn}
          onClick={handleGenerate}
          disabled={!generatePrompt.trim() || atLimit || generating}
        >
          {generating ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
