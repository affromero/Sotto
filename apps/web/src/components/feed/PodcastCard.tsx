'use client';

import { useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Play, Heart, GitFork } from 'lucide-react';
import { getContentBadgeLabel } from '@sotto/shared';
import { useTrack } from '@/components/providers/EventProvider';
import { Badge } from '@/components/ui/Badge';
import { MetadataBadges } from '@/components/ui/MetadataBadges';
import { getPodcastGradient } from '@/lib/podcast-gradient';
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
        href={`/podcast/${podcast.id}`}
        className={styles.cardLink}
        aria-label={`Listen to ${podcast.title} by ${podcast.user.name || 'Unknown'}`}
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
            <h3 className={styles.title}>{podcast.title}</h3>
            <p className={styles.topic}>{podcast.topic}</p>
          </div>

          {/* Compact variant: overlay meta on cover */}
          <div className={styles.compactMeta}>
            <span className={styles.compactCreator}>
              {podcast.user.name || 'Anonymous'}
            </span>
            <span className={styles.compactStat}>
              <Play size={10} aria-hidden="true" />
              {formatCount(podcast.playCount)}
            </span>
          </div>
        </div>

        {/* White body (hidden in compact variant via CSS) */}
        <div className={styles.body}>
          {podcast.forkedFromId && (
            <p className={styles.remixSubline}>
              Remix of {((podcast as unknown) as { forkedFrom?: { title: string } }).forkedFrom?.title || 'another podcast'}
            </p>
          )}

          <div className={styles.creator}>
            <div className={styles.avatar}>
              {podcast.user.image ? (
                <Image
                  src={podcast.user.image}
                  alt={podcast.user.name || 'Creator'}
                  width={24}
                  height={24}
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

          {(podcast.aiProvider || podcast.aiModel || podcast.ttsProvider || podcast.ttsModel || podcast.language) && (
            <MetadataBadges podcast={podcast} categories={['ai', 'tts', 'language']} compact />
          )}

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
          router.push(`/podcast/${podcast.id}?fork=1`);
        }}
        aria-label={`Fork ${podcast.title}`}
        type="button"
      >
        <GitFork size={16} aria-hidden="true" />
        <span>Fork</span>
      </button>
    </article>
  );
}
