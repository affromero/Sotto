'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PodcastList } from '@/components/profile/PodcastList';
import { FollowListModal } from '@/components/profile/FollowListModal';
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
  currentUserId?: string;
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
  currentUserId,
}: ProfileClientProps) {
  const router = useRouter();
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [activeTab, setActiveTab] = useState<'podcasts' | 'remixes' | 'liked'>('podcasts');
  const [followModal, setFollowModal] = useState<'followers' | 'following' | null>(null);

  const [likedPodcasts, setLikedPodcasts] = useState<PodcastSummary[]>([]);
  const [likedLoading, setLikedLoading] = useState(false);
  const likedLoadedRef = useRef(false);

  const loadLikedPodcasts = useCallback(async () => {
    if (likedLoadedRef.current) return;
    likedLoadedRef.current = true;
    setLikedLoading(true);
    try {
      const res = await fetch(`/api/users/${user.id}/liked`);
      const data = await res.json();
      setLikedPodcasts(data.podcasts || []);
    } catch {
      likedLoadedRef.current = false;
    } finally {
      setLikedLoading(false);
    }
  }, [user.id]);

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
        onFollowerClick={() => setFollowModal('followers')}
        onFollowingClick={() => setFollowModal('following')}
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
          className={`${styles.tab} ${activeTab === 'remixes' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('remixes')}
          aria-pressed={activeTab === 'remixes'}
        >
          Remixes
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'liked' ? styles.tabActive : ''}`}
          onClick={() => { setActiveTab('liked'); loadLikedPodcasts(); }}
          aria-pressed={activeTab === 'liked'}
        >
          Liked
        </button>
      </nav>

      {activeTab === 'podcasts' && (
        <PodcastList
          podcasts={podcasts.filter((p) => !p.forkedFromId)}
          emptyMessage={
            isOwnProfile
              ? 'You have not published any podcasts yet.'
              : 'This user has not published any podcasts yet.'
          }
        />
      )}

      {activeTab === 'remixes' && (
        <PodcastList
          podcasts={podcasts.filter((p) => p.forkedFromId)}
          emptyMessage={
            isOwnProfile
              ? 'You have not created any remixes yet.'
              : 'This user has not created any remixes yet.'
          }
        />
      )}

      {activeTab === 'liked' && (
        <PodcastList
          podcasts={likedPodcasts}
          loading={likedLoading}
          emptyMessage={
            isOwnProfile
              ? 'You have not liked any podcasts yet.'
              : 'This user has not liked any podcasts yet.'
          }
        />
      )}

      {followModal && (
        <FollowListModal
          type={followModal}
          userId={user.id}
          isAuthenticated={isAuthenticated}
          currentUserId={currentUserId}
          onClose={() => setFollowModal(null)}
        />
      )}
    </div>
  );
}
