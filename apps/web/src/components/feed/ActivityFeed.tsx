'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityItem, type ActivityData } from './ActivityItem';
import styles from './ActivityFeed.module.css';

interface ActivityFeedProps {
  /** When provided, fetches activity for a specific user (public). Otherwise fetches followed users' activity. */
  userId?: string;
}

interface ActivityResponse {
  activities: ActivityData[];
  hasMore: boolean;
}

export function ActivityFeed({ userId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const initialFetchDone = useRef(false);

  const fetchActivities = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const endpoint = userId
          ? `/api/users/${userId}/activity?page=${pageNum}&limit=20`
          : `/api/activity?page=${pageNum}&limit=20`;

        const response = await fetch(endpoint);
        if (!response.ok) return;

        const data: ActivityResponse = await response.json();

        if (append) {
          setActivities((prev) => [...prev, ...data.activities]);
        } else {
          setActivities(data.activities);
        }
        setHasMore(data.hasMore);
        setPage(pageNum);
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [userId]
  );

  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;
    fetchActivities(1, false);
  }, [fetchActivities]);

  const handleLoadMore = useCallback(() => {
    if (hasMore) {
      fetchActivities(page + 1, true);
    }
  }, [page, hasMore, fetchActivities]);

  if (loading) {
    return (
      <div className={styles.root} aria-label="Activity feed" role="feed">
        <div className={styles.skeletons}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.skeleton}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonBody}>
                <div className={styles.skeletonLine} />
                <div className={styles.skeletonLineShort} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className={styles.root} aria-label="Activity feed" role="feed">
        <div className={styles.empty}>
          <svg
            className={styles.emptyIcon}
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <p className={styles.emptyText}>
            {userId
              ? 'No recent activity'
              : 'No recent activity from people you follow'}
          </p>
          <p className={styles.emptyHint}>
            {userId
              ? 'Check back later for updates.'
              : 'Follow creators to see their activity here.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root} aria-label="Activity feed" role="feed">
      <div className={styles.list}>
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </div>

      {hasMore && (
        <button
          className={styles.loadMore}
          onClick={handleLoadMore}
          disabled={loadingMore}
          type="button"
        >
          {loadingMore ? 'Loading...' : 'Load more activity'}
        </button>
      )}
    </div>
  );
}
