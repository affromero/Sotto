'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PodcastList } from '@/components/profile/PodcastList';
import { CollectionCard } from '@/components/collections/CollectionCard';
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
  isOwnProfile: boolean;
  isAuthenticated?: boolean;
  isEarlyAccess?: boolean;
}

interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  podcastCount: number;
  createdAt: string;
  user?: { id: string; name: string | null; handle: string | null };
}

export function ProfileClient({
  user,
  podcasts,
  podcastCount,
  isOwnProfile,
  isAuthenticated = true,
  isEarlyAccess,
}: ProfileClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'podcasts' | 'collections'>('podcasts');

  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const collectionsLoadedRef = useRef(false);

  const loadCollections = useCallback(async () => {
    if (collectionsLoadedRef.current) return;
    collectionsLoadedRef.current = true;
    setCollectionsLoading(true);
    try {
      const res = await fetch(`/api/users/${user.id}/collections`);
      const data = await res.json();
      setCollections(data.collections || []);
    } catch {
      collectionsLoadedRef.current = false;
    } finally {
      setCollectionsLoading(false);
    }
  }, [user.id]);

  const handleEdit = useCallback(() => {
    router.push('/settings');
  }, [router]);

  return (
    <div className={styles.profileContent}>
      <ProfileHeader
        user={user}
        podcastCount={podcastCount}
        isOwnProfile={isOwnProfile}
        isAuthenticated={isAuthenticated}
        isEarlyAccess={isEarlyAccess}
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
          className={`${styles.tab} ${activeTab === 'collections' ? styles.tabActive : ''}`}
          onClick={() => {
            setActiveTab('collections');
            loadCollections();
          }}
          aria-pressed={activeTab === 'collections'}
        >
          Collections
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

      {activeTab === 'collections' &&
        (collectionsLoading ? (
          <div className={styles.collectionsLoading} role="status" aria-label="Loading collections">
            <div className={styles.collectionsSpinner} />
            <span>Loading collections...</span>
          </div>
        ) : collections.length === 0 ? (
          <div className={styles.collectionsEmpty}>
            <p>
              {isOwnProfile
                ? 'You have not created any collections yet.'
                : 'This user has not created any public collections yet.'}
            </p>
          </div>
        ) : (
          <div className={styles.collectionsGrid}>
            {collections.map((c) => (
              <CollectionCard
                key={c.id}
                id={c.id}
                name={c.name}
                description={c.description}
                podcastCount={c.podcastCount}
                user={c.user}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
