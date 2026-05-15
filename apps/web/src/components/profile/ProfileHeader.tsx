import Image from 'next/image';
import { Badge } from '@/components/ui/Badge';
import { ReportButton } from '@/components/ui/ReportButton';
import styles from './ProfileHeader.module.css';

interface ProfileUser {
  id: string;
  name: string | null;
  handle?: string | null;
  image: string | null;
  bio: string | null;
  createdAt: string;
  role?: string;
}

interface ProfileHeaderProps {
  user: ProfileUser;
  podcastCount: number;
  isOwnProfile: boolean;
  isAuthenticated: boolean;
  isEarlyAccess?: boolean;
  onEdit?: () => void;
}

function getInitials(name: string | null, handle?: string | null): string {
  if (!name && !handle) return 'U';
  const source = name || handle || '';
  return source
    .split(' ')
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatMemberSince(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function ProfileHeader({
  user,
  podcastCount,
  isOwnProfile,
  isAuthenticated,
  isEarlyAccess,
  onEdit,
}: ProfileHeaderProps) {
  return (
    <section className={styles.root} aria-label="User profile">
      <div className={styles.avatarColumn}>
        {user.image ? (
          <Image
            src={user.image}
            alt={`${user.name || 'User'}'s avatar`}
            className={styles.avatar}
            width={80}
            height={80}
          />
        ) : (
          <div
            className={styles.avatarFallback}
            role="img"
            aria-label={`${user.name || 'User'}'s avatar`}
          >
            <span className={styles.initials}>{getInitials(user.name, user.handle)}</span>
          </div>
        )}
      </div>

      <div className={styles.infoColumn}>
        <div className={styles.nameRow}>
          <h1 className={styles.name}>
            <span>{user.name || 'Anonymous'}</span>
            {user.role === 'SYSTEM' && <Badge variant="system">Sotto</Badge>}
            {user.role === 'ADMIN' && <Badge variant="admin">Admin</Badge>}
            {isEarlyAccess && <Badge variant="earlyAccess">Early Access</Badge>}
          </h1>
          <div className={styles.action}>
            {isOwnProfile
              ? onEdit && (
                  <button
                    className={styles.editButton}
                    onClick={onEdit}
                    type="button"
                    aria-label="Edit profile"
                  >
                    Edit Profile
                  </button>
                )
              : isAuthenticated && (
                  <ReportButton targetType="user" targetId={user.id} variant="icon" />
                )}
          </div>
        </div>

        {user.handle && <p className={styles.handle}>@{user.handle}</p>}

        {user.bio && <p className={styles.bio}>{user.bio}</p>}

        <div className={styles.stats} role="group" aria-label="Profile statistics">
          <span className={styles.statText}>
            {podcastCount.toLocaleString()} {podcastCount === 1 ? 'podcast' : 'podcasts'}
          </span>
        </div>

        <p className={styles.memberSince}>
          Member since <time dateTime={user.createdAt}>{formatMemberSince(user.createdAt)}</time>
        </p>
      </div>
    </section>
  );
}
