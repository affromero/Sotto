import styles from './RecommendationCard.module.css';

interface RecommendationCardProps {
  podcast: {
    id: string;
    title: string;
    topic: string;
    duration: number | null;
    playCount: number;
    likeCount: number;
    user: {
      name: string | null;
      handle?: string | null;
      image: string | null;
    };
  };
  onListen: (id: string) => void;
  onFollow: (userId: string) => void;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
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

export function RecommendationCard({ podcast, onListen, onFollow }: RecommendationCardProps) {
  return (
    <article className={styles.root}>
      <div className={styles.content}>
        <h3 className={styles.title}>{podcast.title}</h3>
        <p className={styles.topic}>{podcast.topic}</p>

        <div className={styles.stats}>
          {podcast.duration !== null && (
            <span className={styles.stat}>
              <svg
                className={styles.statIcon}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatDuration(podcast.duration)}
            </span>
          )}
          <span className={styles.stat}>
            <svg
              className={styles.statIcon}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {formatCount(podcast.playCount)}
          </span>
          <span className={styles.stat}>
            <svg
              className={styles.statIcon}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {formatCount(podcast.likeCount)}
          </span>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.creator}>
          <div className={styles.creatorAvatar} aria-hidden="true">
            {podcast.user.image ? (
              <img
                src={podcast.user.image}
                alt=""
                className={styles.creatorAvatarImage}
                loading="lazy"
              />
            ) : (
              <span className={styles.creatorAvatarFallback}>
                {(podcast.user.name || podcast.user.handle || 'U')[0].toUpperCase()}
              </span>
            )}
          </div>
          <span className={styles.creatorName}>
            {podcast.user.name || 'Anonymous'}
          </span>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.followAction}
            onClick={() => onFollow(podcast.id)}
            aria-label={`Follow creator ${podcast.user.name || 'Anonymous'}`}
          >
            Follow
          </button>
          <button
            type="button"
            className={styles.listenButton}
            onClick={() => onListen(podcast.id)}
            aria-label={`Listen to ${podcast.title}`}
          >
            Listen
          </button>
        </div>
      </div>
    </article>
  );
}
