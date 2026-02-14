import Link from 'next/link';
import Image from 'next/image';
import styles from './ForkAttribution.module.css';

interface ForkAttributionProps {
  forkedFrom: {
    id: string;
    title: string;
    user: { id: string; name: string | null; handle: string | null; image: string | null };
  };
}

export function ForkAttribution({ forkedFrom }: ForkAttributionProps) {
  const userName = forkedFrom.user.name || forkedFrom.user.handle || 'Anonymous';
  const userImage = forkedFrom.user.image || '/default-avatar.png';

  return (
    <Link href={`/podcast/${forkedFrom.id}`} className={styles.banner}>
      <svg className={styles.forkIcon} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
      </svg>
      <span className={styles.label}>Forked from</span>
      <div className={styles.userInfo}>
        <Image src={userImage} alt={userName} width={24} height={24} className={styles.avatar} />
        <span className={styles.userName}>{userName}</span>
      </div>
      <span className={styles.separator}>/</span>
      <span className={styles.podcastTitle}>{forkedFrom.title}</span>
    </Link>
  );
}
