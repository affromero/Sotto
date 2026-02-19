'use client';

import Image from 'next/image';
import Link from 'next/link';
import styles from './ActivityItem.module.css';

export interface ActivityData {
  id: string;
  type: string;
  targetId: string | null;
  targetType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
  target: {
    title?: string;
    name?: string;
    handle?: string | null;
  } | null;
}

interface ActivityItemProps {
  activity: ActivityData;
}

function getInitials(name: string | null, handle?: string | null): string {
  if (name) {
    return name
      .split(' ')
      .map((word) => word[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  if (handle) return handle.charAt(0).toUpperCase();
  return 'U';
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;

  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getActionText(type: string): string {
  switch (type) {
    case 'PODCAST_CREATED':
      return 'created a podcast';
    case 'PODCAST_FORKED':
      return 'remixed';
    case 'PODCAST_LIKED':
      return 'liked';
    case 'USER_FOLLOWED':
      return 'followed';
    case 'COMMENT_POSTED':
      return 'commented on';
    case 'COLLECTION_CREATED':
      return 'created a collection';
    default:
      return 'did something';
  }
}

function getTargetLink(activity: ActivityData): { href: string; label: string } | null {
  if (!activity.targetId || !activity.target) return null;

  switch (activity.targetType) {
    case 'podcast':
      return {
        href: `/podcast/${activity.targetId}`,
        label: activity.target.title || 'a podcast',
      };
    case 'user':
      return {
        href: `/profile/${activity.targetId}`,
        label: activity.target.name || 'a user',
      };
    case 'collection':
      return {
        href: `/collections/${activity.targetId}`,
        label: activity.target.name || 'a collection',
      };
    default:
      return null;
  }
}

function getActivityIcon(type: string): React.ReactNode {
  switch (type) {
    case 'PODCAST_CREATED':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'PODCAST_FORKED':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
          <path d="M6 9a9 9 0 0 0 9 9" />
        </svg>
      );
    case 'PODCAST_LIKED':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      );
    case 'USER_FOLLOWED':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      );
    case 'COMMENT_POSTED':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'COLLECTION_CREATED':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      );
    default:
      return null;
  }
}

export function ActivityItem({ activity }: ActivityItemProps) {
  const targetLink = getTargetLink(activity);
  const actionText = getActionText(activity.type);
  const icon = getActivityIcon(activity.type);

  return (
    <article className={styles.root} aria-label={`${activity.user.name || 'User'} ${actionText}`}>
      <Link href={`/profile/${activity.user.id}`} className={styles.avatarLink} aria-label={`View ${activity.user.name || 'user'}'s profile`}>
        {activity.user.image ? (
          <Image
            src={activity.user.image}
            alt={`${activity.user.name || 'User'}'s avatar`}
            className={styles.avatar}
            width={36}
            height={36}
          />
        ) : (
          <div className={styles.avatarFallback} role="img" aria-label={`${activity.user.name || 'User'}'s avatar`}>
            <span className={styles.initials}>{getInitials(activity.user.name, activity.user.handle)}</span>
          </div>
        )}
        {icon && <span className={styles.iconBadge}>{icon}</span>}
      </Link>

      <div className={styles.body}>
        <p className={styles.text}>
          <Link href={`/profile/${activity.user.id}`} className={styles.userName}>
            {activity.user.name || 'Anonymous'}
          </Link>
          {' '}
          <span className={styles.action}>{actionText}</span>
          {targetLink && (
            <>
              {' '}
              <Link href={targetLink.href} className={styles.targetLink}>
                {targetLink.label}
              </Link>
            </>
          )}
        </p>
        <time className={styles.timestamp} dateTime={activity.createdAt}>
          {formatRelativeTime(activity.createdAt)}
        </time>
      </div>
    </article>
  );
}
