'use client';

import { useCallback, useEffect, useState } from 'react';
import { QuestionCard } from './QuestionCard';
import type { QuestionData } from './QuestionCard';
import styles from './CommunityQuestions.module.css';

interface CommunityQuestionsProps {
  podcastId: string;
  refreshTrigger?: number;
}

interface QuestionsResponse {
  items: QuestionData[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function CommunityQuestions({ podcastId, refreshTrigger }: CommunityQuestionsProps) {
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(true);

  const fetchQuestions = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/podcasts/${podcastId}/questions?page=${pageNum}&limit=10`
      );
      if (!response.ok) return;

      const data: QuestionsResponse = await response.json();
      setQuestions(data.items);
      setTotalPages(data.totalPages);
      setTotal(data.total);
      setPage(data.page);
    } catch {
      // Silently handle fetch errors
    } finally {
      setLoading(false);
    }
  }, [podcastId]);

  useEffect(() => {
    fetchQuestions(1);
  }, [fetchQuestions]);

  // Re-fetch when a new question is answered
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchQuestions(1);
    }
  }, [refreshTrigger, fetchQuestions]);

  if (!loading && total === 0) {
    return (
      <section className={styles.root} aria-label="Community Questions">
        <div className={styles.headerStatic}>
          <h3 className={styles.heading}>Community Questions</h3>
        </div>
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
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className={styles.emptyText}>
            No questions yet. Be the first to ask!
          </p>
          <p className={styles.emptyHint}>
            Use the interrupt button while listening to ask a question.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-label="Community Questions">
      <button
        className={styles.header}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        type="button"
      >
        <h3 className={styles.heading}>
          Community Questions
          {total > 0 && (
            <span className={styles.count}>({total})</span>
          )}
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
          {loading ? (
            <div className={styles.skeletons}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={styles.skeleton}>
                  <div className={styles.skeletonVote}>
                    <div className={styles.skeletonCircle} />
                    <div className={styles.skeletonCount} />
                  </div>
                  <div className={styles.skeletonBody}>
                    <div className={styles.skeletonHeader} />
                    <div className={styles.skeletonLine} />
                    <div className={styles.skeletonLineShort} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className={styles.list}>
                {questions.map((q) => (
                  <QuestionCard key={q.id} question={q} podcastId={podcastId} />
                ))}
              </div>

              {totalPages > 1 && (
                <nav className={styles.pagination} aria-label="Questions pagination">
                  <button
                    className={styles.pageButton}
                    onClick={() => fetchQuestions(page - 1)}
                    disabled={page <= 1}
                    aria-label="Previous page"
                    type="button"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Previous
                  </button>
                  <span className={styles.pageInfo}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className={styles.pageButton}
                    onClick={() => fetchQuestions(page + 1)}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    type="button"
                  >
                    Next
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
