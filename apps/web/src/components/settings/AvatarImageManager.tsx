'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './AvatarImageManager.module.css';

interface AvatarImage {
  id: string;
  name: string;
  imageUrl: string;
  sourceType: 'UPLOAD' | 'GENERATED' | 'DEFAULT';
  shareable?: boolean;
}

interface Capabilities {
  canUpload: boolean;
  canGenerate: boolean;
  isVerified: boolean;
  uploadsEnabled: boolean;
}

interface SharedImage {
  shareId: string;
  image: AvatarImage;
  owner: { id: string; name: string | null; handle: string | null; image: string | null };
}

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const SOURCE_LABELS: Record<string, string> = {
  UPLOAD: 'Uploaded',
  GENERATED: 'Generated',
  DEFAULT: 'Default',
};

export function AvatarImageManager() {
  const [images, setImages] = useState<AvatarImage[]>([]);
  const [sharedImages, setSharedImages] = useState<SharedImage[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({
    canUpload: false,
    canGenerate: false,
    isVerified: false,
    uploadsEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch('/api/avatar-images');
      if (!res.ok) throw new Error('Failed to load images');
      const data = await res.json();
      setImages(data.images);
      setSharedImages(data.shared ?? []);
      setCapabilities(data.capabilities);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        formData.append('consentAcknowledged', 'true');

        const res = await fetch('/api/avatar-images', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            typeof data.error === 'string' ? data.error : `Upload failed (${res.status})`
          );
        }

        await fetchImages();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [fetchImages]
  );

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this avatar image?')) return;

    setDeletingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/avatar-images/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.error === 'string' ? data.error : `Delete failed (${res.status})`
        );
      }

      setImages((prev) => prev.filter((img) => img.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleToggleShareable = useCallback(async (id: string, shareable: boolean) => {
    setError(null);
    try {
      const res = await fetch(`/api/avatar-images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareable }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, shareable } : img)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update shareable');
    }
  }, []);

  const atLimit = images.length >= MAX_IMAGES;
  const uploadDisabled = !consentChecked || !capabilities.canUpload || atLimit || uploading;

  if (loading) {
    return (
      <div className={styles.root}>
        <p className={styles.status}>Loading images...</p>
      </div>
    );
  }

  return (
    <div className={styles.root} id="avatar-images">
      <div className={styles.header}>
        <span className={`${styles.count} ${atLimit ? styles.countFull : ''}`}>
          {images.length}/{MAX_IMAGES} images
        </span>
      </div>

      {/* Disabled state notices */}
      {!capabilities.uploadsEnabled && (
        <p className={styles.disabledNotice}>
          Avatar uploads are currently disabled by an administrator.
        </p>
      )}
      {capabilities.uploadsEnabled && !capabilities.isVerified && (
        <p className={styles.disabledNotice}>
          You must be a verified user to upload avatar images. Complete the verification process to
          unlock uploads.
        </p>
      )}

      {images.length === 0 && sharedImages.length === 0 ? (
        <p className={styles.empty}>
          No avatar images yet. Upload a portrait photo to use with lip-sync models.
          {!capabilities.isVerified && ' Verification is required before uploading.'}
        </p>
      ) : (
        <>
          {images.length > 0 && (
            <div className={styles.grid}>
              {images.map((img) => (
                <div key={img.id} className={styles.card}>
                  <img src={img.imageUrl} alt={img.name} className={styles.cardImage} />
                  <span className={styles.cardName}>{img.name}</span>
                  <span className={styles.cardSource}>
                    {SOURCE_LABELS[img.sourceType] ?? img.sourceType}
                  </span>
                  <label className={styles.shareToggle}>
                    <input
                      type="checkbox"
                      checked={img.shareable ?? false}
                      onChange={(e) => handleToggleShareable(img.id, e.target.checked)}
                      aria-label={`Allow sharing of ${img.name}`}
                    />
                    <span className={styles.shareToggleLabel}>Shareable</span>
                  </label>
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

          {/* Shared With You */}
          {sharedImages.length > 0 && (
            <div className={styles.sharedSection}>
              <h3 className={styles.sharedHeader}>Shared With You</h3>
              <div className={styles.grid}>
                {sharedImages.map((shared) => (
                  <div key={shared.shareId} className={`${styles.card} ${styles.cardShared}`}>
                    <img
                      src={shared.image.imageUrl}
                      alt={shared.image.name}
                      className={styles.cardImage}
                    />
                    <span className={styles.cardName}>{shared.image.name}</span>
                    <span className={styles.ownerBadge}>
                      by {shared.owner.name ?? shared.owner.handle ?? 'Unknown'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Consent + Upload */}
      {capabilities.canUpload && (
        <>
          <div className={styles.disclaimer}>
            <label className={styles.consentRow}>
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className={styles.consentCheckbox}
                aria-label="Consent acknowledgment for avatar upload"
              />
              <span className={styles.consentLabel}>
                I confirm this is an image of myself. I have not uploaded someone else&apos;s
                likeness without their written consent. I understand generated avatars may appear in
                podcasts I share or export.
              </span>
            </label>
          </div>

          <div className={styles.actions}>
            <label
              className={`${styles.uploadLabel} ${uploadDisabled ? styles.uploadLabelDisabled : ''}`}
            >
              {uploading ? 'Uploading...' : 'Upload Image'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUpload}
                disabled={uploadDisabled}
                className={styles.hiddenInput}
              />
            </label>
          </div>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
