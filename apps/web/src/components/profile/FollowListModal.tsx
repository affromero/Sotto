'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { UserCard } from './UserCard';
import styles from './FollowListModal.module.css';

interface FollowUser {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  isFollowing: boolean;
}

interface FollowListModalProps {
  type: 'followers' | 'following';
  userId: string;
  isAuthenticated: boolean;
  currentUserId?: string;
  onClose: () => void;
}

const PAGE_SIZE = 20;

export function FollowListModal({
  type,
  userId,
  isAuthenticated,
  currentUserId,
  onClose,
}: FollowListModalProps) {
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (pageNum: number) => {
      const res = await fetch(`/api/users/${userId}/${type}?page=${pageNum}&limit=${PAGE_SIZE}`);
      if (!res.ok) return { items: [] as FollowUser[], total: 0 };
      const data = await res.json();
      const items: FollowUser[] = type === 'followers' ? data.followers : data.following;
      return { items, total: data.total as number };
    },
    [userId, type]
  );

  useEffect(() => {
    setLoading(true);
    fetchPage(1)
      .then(({ items, total: t }) => {
        setUsers(items);
        setTotal(t);
        setPage(1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchPage]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleLoadMore = useCallback(async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const { items } = await fetchPage(nextPage);
      setUsers((prev) => [...prev, ...items]);
      setPage(nextPage);
    } catch {
      // no-op: user can retry
    } finally {
      setLoadingMore(false);
    }
  }, [page, fetchPage]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  const hasMore = users.length < total;
  const title = type === 'followers' ? 'Followers' : 'Following';

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.closeBtn} onClick={onClose} type="button" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {loading && (
            <div className={styles.skeletonList} role="status" aria-label="Loading">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={styles.skeletonItem}>
                  <div className={`${styles.skeletonAvatar} ${styles.skeleton}`} />
                  <div className={styles.skeletonInfo}>
                    <div className={`${styles.skeletonName} ${styles.skeleton}`} />
                    <div className={`${styles.skeletonHandle} ${styles.skeleton}`} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && users.length === 0 && (
            <p className={styles.empty}>
              {type === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
            </p>
          )}

          {!loading && users.length > 0 && (
            <ul className={styles.list} role="list">
              {users.map((user) => (
                <li key={user.id}>
                  <UserCard
                    user={user}
                    isFollowing={user.isFollowing}
                    isOwnProfile={user.id === currentUserId}
                    isAuthenticated={isAuthenticated}
                  />
                </li>
              ))}
            </ul>
          )}

          {!loading && hasMore && (
            <div className={styles.loadMoreContainer}>
              <button
                className={styles.loadMoreBtn}
                onClick={handleLoadMore}
                disabled={loadingMore}
                type="button"
              >
                {loadingMore ? (
                  <span className={styles.spinner} aria-hidden="true" />
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
