'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/providers/ToastProvider';
import styles from './DeletePodcastButton.module.css';

interface DeletePodcastButtonProps {
  podcastId: string;
}

export function DeletePodcastButton({ podcastId }: DeletePodcastButtonProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/podcasts/${podcastId}`, { method: 'DELETE' });
      if (response.ok) {
        showToast('Podcast deleted', 'success');
        router.refresh();
      } else {
        showToast('Failed to delete podcast', 'error');
        setDeleting(false);
        setConfirming(false);
      }
    } catch {
      showToast('Failed to delete podcast', 'error');
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className={styles.confirmOverlay} onClick={(e) => e.preventDefault()}>
        <span className={styles.confirmText}>Delete this podcast?</span>
        <div className={styles.confirmActions}>
          <button
            className={styles.confirmBtn}
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            type="button"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <button
            className={styles.cancelBtn}
            onClick={(e) => {
              e.preventDefault();
              setConfirming(false);
            }}
            disabled={deleting}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      className={styles.deleteBtn}
      onClick={(e) => {
        e.preventDefault();
        setConfirming(true);
      }}
      aria-label="Delete podcast"
      type="button"
    >
      <Trash2 size={14} />
    </button>
  );
}
