'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Link2, Lock } from 'lucide-react';
import type { PodcastVisibility } from '@prisma/client';
import styles from './VisibilityToggle.module.css';

const ALL_VISIBILITIES: PodcastVisibility[] = ['PUBLIC', 'UNLISTED', 'PRIVATE'];

const config: Record<PodcastVisibility, { icon: typeof Globe; label: string; className: string }> =
  {
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cycle = ALL_VISIBILITIES;

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (updating) return;

      const currentIndex = cycle.indexOf(current);
      const next = cycle[(currentIndex + 1) % cycle.length];
      const previous = current;

      setCurrent(next);
      setUpdating(true);
      setErrorMessage(null);

      try {
        const response = await fetch(`/api/v1/podcasts/${podcastId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: next }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          setCurrent(previous);
          if (data?.error && typeof data.error === 'string') {
            setErrorMessage(data.error);
            setTimeout(() => setErrorMessage(null), 4000);
          }
        } else {
          router.refresh();
        }
      } catch {
        setCurrent(previous);
      } finally {
        setUpdating(false);
      }
    },
    [current, updating, podcastId, router, cycle]
  );

  const { icon: Icon, label, className } = config[current];

  return (
    <button
      type="button"
      className={`${styles.pill} ${className} ${updating ? styles.disabled : ''}`}
      onClick={handleClick}
      disabled={updating}
      aria-label={`Visibility: ${label}. Click to change.`}
      title={errorMessage ?? undefined}
    >
      <Icon size={12} />
      <span>{errorMessage ?? label}</span>
    </button>
  );
}
