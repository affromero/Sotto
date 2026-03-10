'use client';

import { useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, Heart, GitFork } from 'lucide-react';
import { getContentBadgeLabel } from '@sotto/shared';
import { useTrack } from '@/components/providers/EventProvider';
import { useAuth } from '@/lib/hooks/useAuth';
import { getPodcastGradient } from '@/lib/podcast-gradient';
import { podcastUrl } from '@/lib/urls';
import type { PodcastSummary } from '@/types/podcast';
import styles from './PodcastCard.module.css';

interface PodcastCardProps {
  podcast: PodcastSummary;
  variant?: 'default' | 'featured' | 'compact';
  onPlay?: (id: string) => void;
  position?: number;
  feedSort?: string;
  searchQuery?: string;
  observeRef?: (
    el: HTMLElement | null,
    podcastId: string,
    position: number,
    feedSort?: string,
    searchQuery?: string
  ) => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function formatCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}


export function PodcastCard({
  podcast,
  variant = 'default',
  onPlay,
  position = 0,
  feedSort,
  searchQuery,
  observeRef,
}: PodcastCardProps) {
  const router = useRouter();
  const track = useTrack();
  const { user } = useAuth();
  const isOwner = user?.id === podcast.user.id;
  const showStats = isOwner && podcast.ownerIsPro;
  const mountTimeRef = useRef(0);
  const duration = formatDuration(podcast.duration);
  const gradient = getPodcastGradient(podcast.id);

  useEffect(() => {
    mountTimeRef.current = Date.now();
  }, []);

  const cardRef = useCallback(
    (el: HTMLElement | null) => {
      if (observeRef && el) {
        observeRef(el, podcast.id, position, feedSort, searchQuery);
      }
    },
    [observeRef, podcast.id, position, feedSort, searchQuery]
  );

  const handleClick = useCallback(() => {
    track({
      eventType: 'feed.click',
      podcastId: podcast.id,
      position,
      feedSort,
      searchQuery,
      dwellTimeMs: Date.now() - mountTimeRef.current,
    });
  }, [track, podcast.id, position, feedSort, searchQuery]);

  const variantClass = variant !== 'default' ? styles[variant] : '';
  const cardClassName = `${styles.card} ${variantClass}`.trim();

  const gradientVars = {
    '--cover-from': gradient.from,
    '--cover-to': gradient.to,
    '--cover-angle': gradient.angle,
  } as React.CSSProperties;

  return (
    <article className={cardClassName} ref={cardRef} style={gradientVars}>
      <Link
        href={podcastUrl(podcast, podcast.user.handle)}
        className={styles.cardLink}
        aria-label={`Listen to ${podcast.title}`}
        onClick={handleClick}
      >
        <div className={styles.cover}>
          <div className={styles.coverBadges}>
            <span className={styles.contentBadge}>
              {getContentBadgeLabel(podcast)}
            </span>
            {duration && <span className={styles.duration}>{duration}</span>}
          </div>

          <div className={styles.coverContent}>
            {podcast.forkedFromId && (
              <p className={styles.remixSubline}>
                Remix of {podcast.forkedFrom?.title || 'another podcast'}
              </p>
            )}
            <h3 className={styles.title}>{podcast.title}</h3>
            <p className={styles.topic}>{podcast.topic}</p>
          </div>

          <div className={styles.coverMeta}>
            <div className={styles.coverMetaLeft}>
              <time className={styles.coverDate} dateTime={podcast.createdAt} suppressHydrationWarning>
                {formatDate(podcast.createdAt)}
              </time>
              {podcast.tags.length > 0 && (
                <div className={styles.coverTags} aria-label="Tags">
                  {podcast.tags.slice(0, 3).map((tag) => (
                    <span key={tag.id} className={styles.coverTag}>
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {showStats && (
              <div className={styles.coverStats}>
                <span className={styles.coverStat} aria-label={`${podcast.playCount} plays`}>
                  <Play size={10} aria-hidden="true" />
                  {formatCount(podcast.playCount)}
                </span>
                <span className={styles.coverStat} aria-label={`${podcast.likeCount} likes`}>
                  <Heart size={10} aria-hidden="true" />
                  {formatCount(podcast.likeCount)}
                </span>
                <span className={styles.coverStat} aria-label={`${podcast.forkCount} forks`}>
                  <GitFork size={10} aria-hidden="true" />
                  {formatCount(podcast.forkCount)}
                </span>
              </div>
            )}
          </div>
        </div>
      </Link>

      {onPlay && podcast.audioUrl && (
        <button
          className={styles.playButton}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay(podcast.id);
          }}
          aria-label={`Play ${podcast.title}`}
          type="button"
        >
          <Play size={18} aria-hidden="true" />
        </button>
      )}

      <button
        className={styles.forkButton}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          router.push(`${podcastUrl(podcast, podcast.user.handle)}?fork=1`);
        }}
        aria-label={`Fork ${podcast.title}`}
        type="button"
      >
        <GitFork size={18} strokeWidth={2.5} aria-hidden="true" />
        <span>Fork</span>
      </button>
    </article>
  );
}
