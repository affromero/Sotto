'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Link2, Lock } from 'lucide-react';
import type { PodcastVisibility } from '@prisma/client';
import styles from './VisibilityToggle.module.css';

const CYCLE: PodcastVisibility[] = ['PUBLIC', 'UNLISTED', 'PRIVATE'];

const config: Record<PodcastVisibility, { icon: typeof Globe; label: string; className: string }> = {
  PUBLIC: { icon: Globe, label: 'Public', className: styles.public },
  UNLISTED: { icon: Link2, label: 'Unlisted', className: styles.unlisted },
  PRIVATE: { icon: Lock, label: 'Private', className: styles.private },
};

interface VisibilityToggleProps {
  podcastId: string;
  visibility: PodcastVisibility;
}

export function VisibilityToggle({ podcastId, visibility }: VisibilityToggleProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(visibility);
  const [updating, setUpdating] = useState(false);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (updating) return;

      const currentIndex = CYCLE.indexOf(current);
      const next = CYCLE[(currentIndex + 1) % CYCLE.length];
      const previous = current;

      setCurrent(next);
      setUpdating(true);

      try {
        const response = await fetch(`/api/podcasts/${podcastId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: next }),
        });

        if (!response.ok) {
          setCurrent(previous);
        } else {
          router.refresh();
        }
      } catch {
        setCurrent(previous);
      } finally {
        setUpdating(false);
      }
    },
    [current, updating, podcastId, router],
  );

  const { icon: Icon, label, className } = config[current];

  return (
    <button
      type="button"
      className={`${styles.pill} ${className} ${updating ? styles.disabled : ''}`}
      onClick={handleClick}
      disabled={updating}
      aria-label={`Visibility: ${label}. Click to change.`}
    >
      <Icon size={12} />
      <span>{label}</span>
    </button>
  );
}
