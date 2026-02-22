'use client';

import { useCallback, useRef, useState } from 'react';
import { Lightbulb, Bookmark, ListMusic, ListOrdered } from 'lucide-react';
import { IdeasTab } from './tabs/IdeasTab';
import { SavedTab } from './tabs/SavedTab';
import { CollectionsTab } from './tabs/CollectionsTab';
import { QueueTab } from './tabs/QueueTab';
import type { SerializedSavedIdea, SerializedPodcastIdea } from './tabs/IdeasTab';
import type { PodcastSummary } from '@/types/podcast';
import styles from './LibraryClient.module.css';

interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  podcastCount: number;
  followerCount: number;
  createdAt: string;
}

interface QueueItem {
  id: string;
  position: number;
  podcastId: string;
  podcast: {
    id: string;
    title: string;
    topic: string;
    duration: number | null;
    user: { id: string; name: string | null; image: string | null };
  };
}

type TabId = 'ideas' | 'saved' | 'collections' | 'queue';

interface TabConfig {
  id: TabId;
  label: string;
  icon: typeof Lightbulb;
}

const TABS: TabConfig[] = [
  { id: 'ideas', label: 'Ideas', icon: Lightbulb },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'collections', label: 'Collections', icon: ListMusic },
  { id: 'queue', label: 'Queue', icon: ListOrdered },
];

interface LibraryClientProps {
  ideas: SerializedSavedIdea[];
  podcastIdeas: SerializedPodcastIdea[];
  counts: { ideas: number; saved: number; collections: number; queue: number };
}

export function LibraryClient({ ideas, podcastIdeas, counts }: LibraryClientProps) {
  const [activeTab, setActiveTab] = useState<TabId>('ideas');

  // Lazy-load state for non-default tabs
  const [savedData, setSavedData] = useState<PodcastSummary[] | null>(null);
  const [savedLoading, setSavedLoading] = useState(false);
  const savedLoadedRef = useRef(false);

  const [collectionsData, setCollectionsData] = useState<CollectionSummary[] | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const collectionsLoadedRef = useRef(false);

  const [queueData, setQueueData] = useState<QueueItem[] | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const queueLoadedRef = useRef(false);

  const loadSaved = useCallback(async () => {
    if (savedLoadedRef.current) return;
    savedLoadedRef.current = true;
    setSavedLoading(true);
    try {
      const res = await fetch('/api/saved');
      const data = await res.json();
      setSavedData(data.podcasts || []);
    } catch {
      savedLoadedRef.current = false;
    } finally {
      setSavedLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    if (collectionsLoadedRef.current) return;
    collectionsLoadedRef.current = true;
    setCollectionsLoading(true);
    try {
      const res = await fetch('/api/collections');
      const data = await res.json();
      setCollectionsData(data.collections || []);
    } catch {
      collectionsLoadedRef.current = false;
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    if (queueLoadedRef.current) return;
    queueLoadedRef.current = true;
    setQueueLoading(true);
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setQueueData(data.queue || []);
    } catch {
      queueLoadedRef.current = false;
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const handleTabClick = (tabId: TabId) => {
    setActiveTab(tabId);
    if (tabId === 'saved') loadSaved();
    if (tabId === 'collections') loadCollections();
    if (tabId === 'queue') loadQueue();
  };

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.title}>My Library</h1>
      </header>

      <nav className={styles.tabs} aria-label="Library sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            onClick={() => handleTabClick(id)}
            aria-pressed={activeTab === id}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            {counts[id] > 0 && <span className={styles.tabCount}>{counts[id]}</span>}
          </button>
        ))}
      </nav>

      <div className={styles.tabContent}>
        {activeTab === 'ideas' && (
          <IdeasTab ideas={ideas} podcastIdeas={podcastIdeas} />
        )}

        {activeTab === 'saved' && (
          savedLoading ? (
            <div className={styles.loading} role="status">
              <div className={styles.spinner} />
              <span>Loading saved podcasts...</span>
            </div>
          ) : savedData !== null ? (
            <SavedTab podcasts={savedData} />
          ) : null
        )}

        {activeTab === 'collections' && (
          collectionsLoading ? (
            <div className={styles.loading} role="status">
              <div className={styles.spinner} />
              <span>Loading collections...</span>
            </div>
          ) : collectionsData !== null ? (
            <CollectionsTab collections={collectionsData} />
          ) : null
        )}

        {activeTab === 'queue' && (
          queueLoading ? (
            <div className={styles.loading} role="status">
              <div className={styles.spinner} />
              <span>Loading queue...</span>
            </div>
          ) : queueData !== null ? (
            <QueueTab items={queueData} />
          ) : null
        )}
      </div>
    </main>
  );
}
