'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CommentCompose } from './CommentCompose';
import { CommentCard } from './CommentCard';
import type { CommentData } from './CommentCompose';
import styles from './CommentSection.module.css';

interface CommentSectionProps {
  podcastId: string;
  podcastOwnerId: string;
  currentUserId?: string;
  commentCount: number;
}

interface CommentsResponse {
  items: CommentData[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function CommentSection({
  podcastId,
  podcastOwnerId,
  currentUserId,
  commentCount,
}: CommentSectionProps) {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(commentCount);
  const [expanded, setExpanded] = useState(true);
  const initialFetchDone = useRef(false);

  const fetchComments = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetch(
          `/api/podcasts/${podcastId}/comments?page=${pageNum}&limit=10`
        );
        if (!response.ok) return;

        const data: CommentsResponse = await response.json();

        if (append) {
          setComments((prev) => [...prev, ...data.items]);
        } else {
          setComments(data.items);
        }
        setTotalPages(data.totalPages);
        setTotal(data.total);
        setPage(data.page);
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [podcastId]
  );

  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;
    fetchComments(1, false);
  }, [fetchComments]);

  const handleNewComment = useCallback((comment: CommentData) => {
    setComments((prev) => [comment, ...prev]);
    setTotal((t) => t + 1);
  }, []);

  const handleDelete = useCallback((commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  const handleLoadMore = useCallback(() => {
    if (page < totalPages) {
      fetchComments(page + 1, true);
    }
  }, [page, totalPages, fetchComments]);

  return (
    <section className={styles.root} aria-label="Comments">
      <button
        className={styles.header}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        type="button"
      >
        <h3 className={styles.heading}>
          Comments
          {total > 0 && <span className={styles.count}>({total})</span>}
        </h3>
        <svg
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className={styles.content}>
          {/* Compose new top-level comment (only for authenticated users) */}
          {currentUserId && (
            <div className={styles.compose}>
              <CommentCompose podcastId={podcastId} onSubmit={handleNewComment} />
            </div>
          )}

          {loading ? (
            <div className={styles.skeletons}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={styles.skeleton}>
                  <div className={styles.skeletonAvatar} />
                  <div className={styles.skeletonBody}>
                    <div className={styles.skeletonHeader} />
                    <div className={styles.skeletonLine} />
                    <div className={styles.skeletonLineShort} />
                  </div>
                </div>
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div className={styles.empty}>
              <svg
                className={styles.emptyIcon}
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p className={styles.emptyText}>No comments yet</p>
              <p className={styles.emptyHint}>Be the first to share your thoughts.</p>
            </div>
          ) : (
            <>
              <div className={styles.list}>
                {comments.map((comment) => (
                  <CommentCard
                    key={comment.id}
                    comment={comment}
                    podcastId={podcastId}
                    currentUserId={currentUserId}
                    podcastOwnerId={podcastOwnerId}
                    onDelete={handleDelete}
                  />
                ))}
              </div>

              {page < totalPages && (
                <button
                  className={styles.loadMore}
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  type="button"
                >
                  {loadingMore ? 'Loading...' : 'Load more comments'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
