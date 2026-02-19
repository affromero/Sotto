'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { FollowButton } from '@/components/profile/FollowButton';
import styles from './UserSearchGrid.module.css';

export interface UserDiscoveryResult {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  bio: string | null;
  followerCount: number;
  podcastCount: number;
  isFollowing: boolean;
  interests: string[];
}

interface UserSearchGridProps {
  users: UserDiscoveryResult[];
  loading: boolean;
  emptyMessage: string;
  isAuthenticated: boolean;
  currentUserId: string | null;
}

function SkeletonCard() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={styles.cardHeader}>
        <div className={styles.skeletonAvatar} />
        <div className={styles.skeletonInfo}>
          <div className={styles.skeletonName} />
          <div className={styles.skeletonHandle} />
        </div>
      </div>
      <div className={styles.skeletonBio} />
      <div className={styles.skeletonChips}>
        <div className={styles.skeletonChip} />
        <div className={styles.skeletonChip} />
      </div>
    </div>
  );
}

function UserResultCard({
  user,
  isAuthenticated,
  currentUserId,
}: {
  user: UserDiscoveryResult;
  isAuthenticated: boolean;
  currentUserId: string | null;
}) {
  const [following, setFollowing] = useState(user.isFollowing);
  const [followLoading, setFollowLoading] = useState(false);

  const handleFollowToggle = useCallback(async () => {
    if (!currentUserId) return;
    setFollowLoading(true);
    try {
      const method = following ? 'DELETE' : 'POST';
      const res = await fetch(`/api/users/${user.id}/follow`, { method });
      if (res.ok) {
        setFollowing(!following);
      }
    } finally {
      setFollowLoading(false);
    }
  }, [following, user.id, currentUserId]);

  const profileHref = user.handle
    ? `/profile/handle/${user.handle}`
    : `/profile/${user.id}`;

  return (
    <div className={styles.card}>
      <Link href={profileHref} className={styles.cardLink}>
        <div className={styles.cardHeader}>
          <div className={styles.avatarWrapper}>
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name ?? 'User'}
                width={48}
                height={48}
                className={styles.avatar}
              />
            ) : (
              <div className={styles.avatarFallback}>
                {(user.name ?? user.handle ?? 'U')[0].toUpperCase()}
              </div>
            )}
          </div>
          <div className={styles.userInfo}>
            <span className={styles.name}>{user.name ?? 'Anonymous'}</span>
            {user.handle && (
              <span className={styles.handle}>@{user.handle}</span>
            )}
          </div>
        </div>
        {user.bio && (
          <p className={styles.bio}>{user.bio}</p>
        )}
      </Link>

      <div className={styles.statsRow}>
        <span className={styles.stat}>
          <strong>{user.followerCount}</strong> followers
        </span>
        <span className={styles.stat}>
          <strong>{user.podcastCount}</strong> podcasts
        </span>
      </div>

      {user.interests.length > 0 && (
        <div className={styles.interestChips}>
          {user.interests.slice(0, 3).map((interest) => (
            <span key={interest} className={styles.chip}>
              {interest}
            </span>
          ))}
        </div>
      )}

      {isAuthenticated && currentUserId !== user.id && (
        <div className={styles.followAction}>
          <FollowButton
            isFollowing={following}
            onClick={handleFollowToggle}
            loading={followLoading}
            size="small"
          />
        </div>
      )}
    </div>
  );
}

export function UserSearchGrid({
  users,
  loading,
  emptyMessage,
  isAuthenticated,
  currentUserId,
}: UserSearchGridProps) {
  if (loading) {
    return (
      <div className={styles.grid} role="status" aria-label="Loading people">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
        <span className={styles.srOnly}>Loading people...</span>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className={styles.empty} role="status">
        <div className={styles.emptyIcon} aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
            <circle cx="32" cy="26" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="M18 48c0-7.7 6.3-14 14-14s14 6.3 14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <p className={styles.emptyMessage}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {users.map((user) => (
        <UserResultCard
          key={user.id}
          user={user}
          isAuthenticated={isAuthenticated}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}
