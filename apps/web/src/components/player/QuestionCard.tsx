'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { profileUrl } from '@/lib/urls';
import styles from './QuestionCard.module.css';

export interface QuestionData {
  id: string;
  question: string;
  answer: string | null;
  timestamp: number;
  upvoteCount: number;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    handle: string | null;
  };
  hasVoted: boolean;
}

interface QuestionCardProps {
  question: QuestionData;
  podcastId: string;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTimeAgo(dateString: string): string {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function QuestionCard({ question, podcastId }: QuestionCardProps) {
  const [voted, setVoted] = useState(question.hasVoted);
  const [upvoteCount, setUpvoteCount] = useState(question.upvoteCount);
  const [voting, setVoting] = useState(false);

  const handleVote = useCallback(async () => {
    if (voting) return;

    const previousVoted = voted;
    const previousCount = upvoteCount;

    // Optimistic update
    setVoted(!voted);
    setUpvoteCount(voted ? upvoteCount - 1 : upvoteCount + 1);
    setVoting(true);

    try {
      const response = await fetch(
        `/api/podcasts/${podcastId}/interact/${question.id}/vote`,
        { method: 'POST' }
      );

      if (!response.ok) {
        // Revert on failure
        setVoted(previousVoted);
        setUpvoteCount(previousCount);
        return;
      }

      const data: { voted: boolean; upvoteCount: number } = await response.json();
      setVoted(data.voted);
      setUpvoteCount(data.upvoteCount);
    } catch {
      setVoted(previousVoted);
      setUpvoteCount(previousCount);
    } finally {
      setVoting(false);
    }
  }, [voted, upvoteCount, voting, podcastId, question.id]);

  return (
    <article className={styles.card}>
      <div className={styles.voteColumn}>
        <button
          className={`${styles.voteButton} ${voted ? styles.voteButtonActive : ''}`}
          onClick={handleVote}
          disabled={voting}
          aria-label={voted ? 'Remove upvote' : 'Upvote this question'}
          aria-pressed={voted}
          type="button"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={voted ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <span className={`${styles.voteCount} ${voted ? styles.voteCountActive : ''}`}>
          {upvoteCount}
        </span>
      </div>

      <div className={styles.content}>
        <div className={styles.header}>
          <Link href={profileUrl(question.user)} className={styles.userLink}>
            <div className={styles.avatar}>
              {question.user.image ? (
                <Image
                  src={question.user.image}
                  alt={question.user.name || 'User'}
                  width={24}
                  height={24}
                  className={styles.avatarImg}
                />
              ) : (
                <span className={styles.avatarFallback}>
                  {(question.user.name || question.user.handle || 'U')[0].toUpperCase()}
                </span>
              )}
            </div>
            <span className={styles.userName}>
              {question.user.name || 'Anonymous'}
            </span>
          </Link>
          <span className={styles.metaSeparator} aria-hidden="true" />
          <span className={styles.timestamp}>
            at {formatTimestamp(question.timestamp)}
          </span>
          <span className={styles.metaSeparator} aria-hidden="true" />
          <time className={styles.timeAgo} dateTime={question.createdAt}>
            {formatTimeAgo(question.createdAt)}
          </time>
        </div>

        <p className={styles.questionText}>{question.question}</p>

        {question.answer && (
          <div className={styles.answerBlock}>
            <span className={styles.answerLabel}>Answer</span>
            <p className={styles.answerText}>{question.answer}</p>
          </div>
        )}
      </div>
    </article>
  );
}
