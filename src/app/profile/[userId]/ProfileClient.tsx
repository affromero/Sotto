'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PodcastList } from '@/components/profile/PodcastList';
import type { PodcastSummary } from '@/types/podcast';
import styles from './page.module.css';

interface ProfileUser {
  id: string;
  name: string | null;
  handle?: string | null;
  image: string | null;
  bio: string | null;
  createdAt: string;
  role?: string;
}

interface ProfileClientProps {
  user: ProfileUser;
  podcasts: PodcastSummary[];
  podcastCount: number;
  followerCount: number;
  followingCount: number;
  isOwnProfile: boolean;
  initialIsFollowing: boolean;
  isAuthenticated?: boolean;
}

export function ProfileClient({
  user,
  podcasts,
  podcastCount,
  followerCount: initialFollowerCount,
  followingCount,
  isOwnProfile,
  initialIsFollowing,
  isAuthenticated = true,
}: ProfileClientProps) {
  const router = useRouter();
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [activeTab, setActiveTab] = useState<'podcasts' | 'liked'>('podcasts');

  const handleFollow = useCallback(async () => {
    const newFollowing = !isFollowing;
    setIsFollowing(newFollowing);
    setFollowerCount((c) => c + (newFollowing ? 1 : -1));

    try {
      await fetch(`/api/users/${user.id}/follow`, {
        method: newFollowing ? 'POST' : 'DELETE',
      });
    } catch {
      setIsFollowing(!newFollowing);
      setFollowerCount((c) => c + (newFollowing ? -1 : 1));
    }
  }, [isFollowing, user.id]);

  const handleEdit = useCallback(() => {
    router.push('/settings');
  }, [router]);

  return (
    <div className={styles.profileContent}>
      <ProfileHeader
        user={user}
        podcastCount={podcastCount}
        followerCount={followerCount}
        followingCount={followingCount}
        isOwnProfile={isOwnProfile}
        isFollowing={isFollowing}
        isAuthenticated={isAuthenticated}
        onFollow={handleFollow}
        onEdit={handleEdit}
      />

      <nav className={styles.tabs} aria-label="Profile sections">
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'podcasts' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('podcasts')}
          aria-pressed={activeTab === 'podcasts'}
        >
          Podcasts
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'liked' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('liked')}
          aria-pressed={activeTab === 'liked'}
        >
          Liked
        </button>
      </nav>

      {activeTab === 'podcasts' && (
        <PodcastList
          podcasts={podcasts}
          emptyMessage={
            isOwnProfile
              ? 'You have not published any podcasts yet.'
              : 'This user has not published any podcasts yet.'
          }
        />
      )}

      {activeTab === 'liked' && (
        <div className={styles.comingSoon}>
          <p className={styles.comingSoonText}>Liked podcasts coming soon.</p>
        </div>
      )}
    </div>
  );
}
