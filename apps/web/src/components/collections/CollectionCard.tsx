import Link from 'next/link';
import { ListMusic, Users } from 'lucide-react';
import styles from './CollectionCard.module.css';

interface CollectionCardProps {
  id: string;
  name: string;
  description: string | null;
  podcastCount: number;
  followerCount: number;
  user?: {
    id: string;
    name: string | null;
    handle: string | null;
  };
}

function formatCount(count: number): string {
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toString();
}

export function CollectionCard({
  id,
  name,
  description,
  podcastCount,
  followerCount,
  user,
}: CollectionCardProps) {
  return (
    <Link href={`/collections/${id}`} className={styles.card}>
      <div className={styles.header}>
        <div className={styles.icon} aria-hidden="true">
          <ListMusic size={20} />
        </div>
        <h3 className={styles.name}>{name}</h3>
      </div>

      {description && (
        <p className={styles.description}>{description}</p>
      )}

      <div className={styles.footer}>
        <div className={styles.stats}>
          <span className={styles.stat}>
            <ListMusic size={14} aria-hidden="true" />
            {formatCount(podcastCount)} {podcastCount === 1 ? 'podcast' : 'podcasts'}
          </span>
          <span className={styles.stat}>
            <Users size={14} aria-hidden="true" />
            {formatCount(followerCount)} {followerCount === 1 ? 'follower' : 'followers'}
          </span>
        </div>
        {user && (
          <span className={styles.creator}>
            by {user.name || user.handle || 'Anonymous'}
          </span>
        )}
      </div>
    </Link>
  );
}
