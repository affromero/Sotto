'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FollowButton } from './FollowButton';
import styles from './UserCard.module.css';

interface UserCardUser {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
}

interface UserCardProps {
  user: UserCardUser;
  isFollowing: boolean;
  isOwnProfile: boolean;
  isAuthenticated: boolean;
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function UserCard({ user, isFollowing: initialIsFollowing, isOwnProfile, isAuthenticated }: UserCardProps) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [loading, setLoading] = useState(false);

  const handleFollow = useCallback(async () => {
    const newFollowing = !isFollowing;
    setIsFollowing(newFollowing);
    setLoading(true);

    try {
      await fetch(`/api/users/${user.id}/follow`, {
        method: newFollowing ? 'POST' : 'DELETE',
      });
    } catch {
      setIsFollowing(!newFollowing);
    } finally {
      setLoading(false);
    }
  }, [isFollowing, user.id]);

  const showFollowButton = isAuthenticated && !isOwnProfile;

  return (
    <div className={styles.root}>
      <Link href={`/profile/${user.id}`} className={styles.userLink} aria-label={`View ${user.name || 'user'}'s profile`}>
        {user.image ? (
          <Image
            src={user.image}
            alt={`${user.name || 'User'}'s avatar`}
            className={styles.avatar}
            width={40}
            height={40}
          />
        ) : (
          <div className={styles.avatarFallback} role="img" aria-label={`${user.name || 'User'}'s avatar`}>
            <span className={styles.initials}>{getInitials(user.name)}</span>
          </div>
        )}
        <div className={styles.info}>
          <span className={styles.name}>{user.name || 'Anonymous'}</span>
          {user.handle && <span className={styles.handle}>@{user.handle}</span>}
        </div>
      </Link>
      {showFollowButton && (
        <div className={styles.action}>
          <FollowButton isFollowing={isFollowing} onClick={handleFollow} loading={loading} size="small" />
        </div>
      )}
    </div>
  );
}
