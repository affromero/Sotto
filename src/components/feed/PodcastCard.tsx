'use client';

import { useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Play, Heart, GitFork } from 'lucide-react';
import { useTrack } from '@/components/providers/EventProvider';
import { Badge } from '@/components/ui/Badge';
import type { PodcastSummary } from '@/types/podcast';
import styles from './PodcastCard.module.css';

interface PodcastCardProps {
  podcast: PodcastSummary;
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
  onPlay,
  position = 0,
  feedSort,
  searchQuery,
  observeRef,
}: PodcastCardProps) {
  const track = useTrack();
  const mountTimeRef = useRef(0);
  const duration = formatDuration(podcast.duration);

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

  return (
    <article className={styles.card} ref={cardRef}>
      <Link
        href={`/podcast/${podcast.id}`}
        className={styles.cardLink}
        aria-label={`Listen to ${podcast.title} by ${podcast.user.name || 'Unknown'}`}
        onClick={handleClick}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>{podcast.title}</h3>
          {duration && <span className={styles.duration}>{duration}</span>}
        </div>

        <p className={styles.topic}>{podcast.topic}</p>

        <div className={styles.creator}>
          <div className={styles.avatar}>
            {podcast.user.image ? (
              <Image
                src={podcast.user.image}
                alt={podcast.user.name || 'Creator'}
                width={32}
                height={32}
                className={styles.avatarImage}
              />
            ) : (
              <span className={styles.avatarFallback}>
                {(podcast.user.name || '?')[0].toUpperCase()}
              </span>
            )}
          </div>
          <span className={styles.creatorName}>
            {podcast.user.name || 'Anonymous'}
            {podcast.user.role === 'CREATOR' && <Badge variant="creator">Creator</Badge>}
            {podcast.user.role === 'ADMIN' && <Badge variant="admin">Admin</Badge>}
          </span>
          <span className={styles.dot} aria-hidden="true" />
          <time className={styles.date} dateTime={podcast.createdAt}>
            {formatDate(podcast.createdAt)}
          </time>
        </div>

        <div className={styles.stats}>
          <span className={styles.stat} aria-label={`${podcast.playCount} plays`}>
            <Play size={14} aria-hidden="true" />
            <span>{formatCount(podcast.playCount)}</span>
          </span>
          <span className={styles.stat} aria-label={`${podcast.likeCount} likes`}>
            <Heart size={14} aria-hidden="true" />
            <span>{formatCount(podcast.likeCount)}</span>
          </span>
          <span className={styles.stat} aria-label={`${podcast.forkCount} forks`}>
            <GitFork size={14} aria-hidden="true" />
            <span>{formatCount(podcast.forkCount)}</span>
          </span>
        </div>

        {podcast.tags.length > 0 && (
          <div className={styles.tags} aria-label="Tags">
            {podcast.tags.map((tag) => (
              <span key={tag.id} className={styles.tag}>
                {tag.name}
              </span>
            ))}
          </div>
        )}
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
    </article>
  );
}
