'use client';

import styles from './CreatorSuggestion.module.css';

interface CreatorSuggestionProps {
  creator: {
    id: string;
    name: string;
    image: string | null;
    podcastCount: number;
  };
  onFollow: (id: string) => void;
  isFollowing?: boolean;
}

export function CreatorSuggestion({
  creator,
  onFollow,
  isFollowing = false,
}: CreatorSuggestionProps) {
  return (
    <div className={styles.root}>
      <div className={styles.avatar} aria-hidden="true">
        {creator.image ? (
          <img
            src={creator.image}
            alt=""
            className={styles.avatarImage}
            loading="lazy"
          />
        ) : (
          <span className={styles.avatarFallback}>
            {creator.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className={styles.info}>
        <span className={styles.name}>{creator.name}</span>
        <span className={styles.meta}>
          {creator.podcastCount} {creator.podcastCount === 1 ? 'podcast' : 'podcasts'}
        </span>
      </div>

      <button
        type="button"
        className={`${styles.followButton} ${isFollowing ? styles.following : ''}`}
        onClick={() => onFollow(creator.id)}
        aria-label={isFollowing ? `Unfollow ${creator.name}` : `Follow ${creator.name}`}
      >
        {isFollowing ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}
