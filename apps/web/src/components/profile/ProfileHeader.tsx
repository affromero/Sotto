import Image from 'next/image';
import { Badge } from '@/components/ui/Badge';
import { FollowButton } from './FollowButton';
import { FollowerCount } from './FollowerCount';
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
  followerCount: number;
  followingCount: number;
  isOwnProfile: boolean;
  isFollowing: boolean;
  isAuthenticated: boolean;
  onFollow: () => void;
  onEdit?: () => void;
  onFollowerClick?: () => void;
  onFollowingClick?: () => void;
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
  followerCount,
  followingCount,
  isOwnProfile,
  isFollowing,
  isAuthenticated,
  onFollow,
  onEdit,
  onFollowerClick,
  onFollowingClick,
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
            <span className={styles.initials}>{getInitials(user.name)}</span>
          </div>
        )}
      </div>

      <div className={styles.infoColumn}>
        <div className={styles.nameRow}>
          <h1 className={styles.name}>
            {user.name || 'Anonymous'}
            {user.role === 'SYSTEM' && <Badge variant="system">Sotto</Badge>}
            {user.role === 'CREATOR' && <Badge variant="creator">Creator</Badge>}
            {user.role === 'ADMIN' && <Badge variant="admin">Admin</Badge>}
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
              : isAuthenticated && <FollowButton isFollowing={isFollowing} onClick={onFollow} />}
          </div>
        </div>

        {user.handle && <p className={styles.handle}>@{user.handle}</p>}

        {user.bio && <p className={styles.bio}>{user.bio}</p>}

        <div className={styles.stats} role="group" aria-label="Profile statistics">
          <FollowerCount count={podcastCount} label="podcasts" />
          <FollowerCount count={followerCount} label="followers" onClick={onFollowerClick} />
          <FollowerCount count={followingCount} label="following" onClick={onFollowingClick} />
        </div>

        <p className={styles.memberSince}>
          Member since <time dateTime={user.createdAt}>{formatMemberSince(user.createdAt)}</time>
        </p>
      </div>
    </section>
  );
}
