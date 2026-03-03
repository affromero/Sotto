'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import styles from './ProposeRenditionButton.module.css';

interface ProposeRenditionButtonProps {
  podcastId: string;
  voiceTrackId: string;
  originalPodcastId: string;
  originalTitle: string;
}

export function ProposeRenditionButton({
  podcastId,
  voiceTrackId,
  originalPodcastId,
  originalTitle,
}: ProposeRenditionButtonProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handlePropose = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/podcasts/${podcastId}/voice-tracks/${voiceTrackId}/propose`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message.trim() || undefined }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to propose rendition');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setModalOpen(false);
    setMessage('');
    setError(null);
  };

  if (success) {
    return (
      <div className={styles.successBanner}>
        <Check size={18} />
        <span>
          Proposed to{' '}
          <button
            className={styles.linkBtn}
            onClick={() => router.push(`/podcast/${originalPodcastId}`)}
            type="button"
          >
            {originalTitle}
          </button>
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        className={styles.proposeBtn}
        onClick={() => setModalOpen(true)}
        type="button"
      >
        <Send size={16} />
        <span>Propose to &ldquo;{originalTitle}&rdquo;</span>
      </button>

      <Modal isOpen={modalOpen} onClose={handleClose} size="small">
        <div className={styles.modal}>
          <div className={styles.header}>
            <h3 className={styles.title}>Propose Rendition</h3>
            <p className={styles.subtitle}>
              Submit your voice rendition to the owner of &ldquo;{originalTitle}&rdquo;
              for review.
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor="propose-message" className={styles.label}>
              Message (optional)
            </label>
            <textarea
              id="propose-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your rendition or why it fits..."
              className={styles.textarea}
              rows={3}
              maxLength={500}
            />
            <span className={styles.charCount}>{message.length}/500</span>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              <X size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={loading}
              onClick={handlePropose}
            >
              {loading ? 'Proposing...' : 'Propose'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
