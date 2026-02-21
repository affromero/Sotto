'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { FollowButton } from '@/components/profile/FollowButton';
import { profileUrl } from '@/lib/urls';
import styles from './SuggestedFollows.module.css';

interface SuggestedUser {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  bio: string | null;
  followerCount: number;
  podcastCount: number;
  sharedInterests: string[];
}

interface SuggestedFollowsProps {
  currentUserId: string;
}

function SkeletonCard() {
  return (
    <div className={styles.cardWrapper}>
      <div className={styles.card} aria-hidden="true">
        <div className={styles.skeletonAvatar} />
        <div className={styles.skeletonName} />
        <div className={styles.skeletonHandle} />
        <div className={styles.skeletonChips}>
          <div className={styles.skeletonChip} />
        </div>
      </div>
    </div>
  );
}

function SuggestedUserCard({
  user,
  currentUserId,
}: {
  user: SuggestedUser;
  currentUserId: string;
}) {
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const handleFollowToggle = useCallback(async () => {
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
  }, [following, user.id]);

  const profileHref = profileUrl(user);

  return (
    <div className={styles.cardWrapper}>
      <div className={styles.card}>
        <Link href={profileHref} className={styles.cardLink}>
          <div className={styles.avatarWrapper}>
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name ?? 'User'}
                width={56}
                height={56}
                className={styles.avatar}
              />
            ) : (
              <div className={styles.avatarFallback}>
                {(user.name ?? user.handle ?? 'U')[0].toUpperCase()}
              </div>
            )}
          </div>
          <span className={styles.name}>{user.name ?? 'Anonymous'}</span>
          {user.handle && (
            <span className={styles.handle}>@{user.handle}</span>
          )}
        </Link>

        {user.sharedInterests.length > 0 && (
          <div className={styles.sharedChips}>
            {user.sharedInterests.slice(0, 2).map((interest) => (
              <span key={interest} className={styles.chip}>
                {interest}
              </span>
            ))}
          </div>
        )}

        <div className={styles.statsRow}>
          <span className={styles.stat}>
            <strong>{user.followerCount}</strong> followers
          </span>
          <span className={styles.statDot}>·</span>
          <span className={styles.stat}>
            <strong>{user.podcastCount}</strong> pods
          </span>
        </div>

        {currentUserId !== user.id && (
          <FollowButton
            isFollowing={following}
            onClick={handleFollowToggle}
            loading={followLoading}
            size="small"
          />
        )}
      </div>
    </div>
  );
}

export function SuggestedFollows({ currentUserId }: SuggestedFollowsProps) {
  const [users, setUsers] = useState<SuggestedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchSuggestions() {
      try {
        const res = await fetch('/api/users/suggested');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setUsers(data.users);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSuggestions();
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed) return null;
  if (!loading && users.length === 0) return null;

  return (
    <section className={styles.root} aria-label="Suggested people to follow">
      <div className={styles.header}>
        <h2 className={styles.heading}>People You Might Like</h2>
        <button
          className={styles.dismissBtn}
          onClick={() => setDismissed(true)}
          type="button"
          aria-label="Dismiss suggestions"
        >
          Dismiss
        </button>
      </div>
      <div className={styles.scrollContainer}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))
          : users.map((user) => (
              <SuggestedUserCard
                key={user.id}
                user={user}
                currentUserId={currentUserId}
              />
            ))}
      </div>
    </section>
  );
}
