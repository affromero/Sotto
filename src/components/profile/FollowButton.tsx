'use client';

import { useState } from 'react';
import styles from './FollowButton.module.css';

interface FollowButtonProps {
  isFollowing: boolean;
  onClick: () => void;
  loading?: boolean;
  size?: 'small' | 'medium';
}

export function FollowButton({
  isFollowing,
  onClick,
  loading = false,
  size = 'medium',
}: FollowButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const showUnfollow = isFollowing && isHovered;

  return (
    <button
      className={`${styles.button} ${styles[size]} ${isFollowing ? styles.following : styles.notFollowing} ${showUnfollow ? styles.unfollow : ''}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={loading}
      type="button"
      aria-label={isFollowing ? 'Unfollow' : 'Follow'}
      aria-pressed={isFollowing}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {!loading && (
        <span className={styles.text}>
          {showUnfollow ? 'Unfollow' : isFollowing ? 'Following' : 'Follow'}
        </span>
      )}
    </button>
  );
}
