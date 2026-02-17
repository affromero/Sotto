'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { ReportButton } from '@/components/ui/ReportButton';
import { CommentCompose } from './CommentCompose';
import type { CommentData } from './CommentCompose';
import styles from './CommentCard.module.css';

interface CommentCardProps {
  comment: CommentData;
  podcastId: string;
  currentUserId?: string;
  podcastOwnerId?: string;
  onDelete: (id: string) => void;
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function CommentCard({
  comment,
  podcastId,
  currentUserId,
  podcastOwnerId,
  onDelete,
}: CommentCardProps) {
  const [showReplyCompose, setShowReplyCompose] = useState(false);
  const [replies, setReplies] = useState<CommentData[]>([]);
  const [showReplies, setShowReplies] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyCount, setReplyCount] = useState(comment.replyCount);
  const [deleting, setDeleting] = useState(false);

  const canDelete = currentUserId === comment.user.id || currentUserId === podcastOwnerId;

  const handleDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(
        `/api/podcasts/${podcastId}/comments/${comment.id}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        onDelete(comment.id);
      }
    } finally {
      setDeleting(false);
    }
  }, [deleting, podcastId, comment.id, onDelete]);

  const handleLoadReplies = useCallback(async () => {
    if (showReplies) {
      setShowReplies(false);
      return;
    }
    setLoadingReplies(true);
    try {
      const response = await fetch(
        `/api/podcasts/${podcastId}/comments/${comment.id}/replies?limit=50`
      );
      if (!response.ok) return;
      const data = await response.json();
      setReplies(data.items);
      setShowReplies(true);
    } finally {
      setLoadingReplies(false);
    }
  }, [showReplies, podcastId, comment.id]);

  const handleReplySubmit = useCallback(
    (newReply: CommentData) => {
      setReplies((prev) => [...prev, newReply]);
      setReplyCount((c) => c + 1);
      setShowReplyCompose(false);
      setShowReplies(true);
    },
    []
  );

  const handleReplyDelete = useCallback((replyId: string) => {
    setReplies((prev) => prev.filter((r) => r.id !== replyId));
    setReplyCount((c) => Math.max(0, c - 1));
  }, []);

  const profileHref = comment.user.handle
    ? `/profile/handle/${comment.user.handle}`
    : `/profile/${comment.user.id}`;

  return (
    <div className={styles.root}>
      <div className={styles.main}>
        <Link href={profileHref} className={styles.avatar} aria-label={`View ${comment.user.name || 'user'} profile`}>
          {comment.user.image ? (
            <Image
              src={comment.user.image}
              alt=""
              width={28}
              height={28}
              className={styles.avatarImg}
            />
          ) : (
            <span className={styles.avatarFallback}>
              {(comment.user.name || '?')[0].toUpperCase()}
            </span>
          )}
        </Link>

        <div className={styles.body}>
          <div className={styles.header}>
            <Link href={profileHref} className={styles.authorName}>
              {comment.user.name || 'Anonymous'}
            </Link>
            <span className={styles.time}>{formatRelativeTime(comment.createdAt)}</span>
            {comment.timestamp !== null && comment.timestamp !== undefined && (
              <span className={styles.timestampBadge} aria-label={`At ${formatTimestamp(comment.timestamp)}`}>
                {formatTimestamp(comment.timestamp)}
              </span>
            )}
          </div>

          <p className={styles.content}>{comment.content}</p>

          <div className={styles.footer}>
            {currentUserId && (
              <button
                className={styles.footerBtn}
                onClick={() => setShowReplyCompose((prev) => !prev)}
                type="button"
              >
                Reply
              </button>
            )}
            {replyCount > 0 && (
              <button
                className={styles.footerBtn}
                onClick={handleLoadReplies}
                disabled={loadingReplies}
                type="button"
              >
                {loadingReplies
                  ? 'Loading...'
                  : showReplies
                    ? 'Hide replies'
                    : `View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
              </button>
            )}
            {canDelete && (
              <button
                className={styles.deleteBtn}
                onClick={handleDelete}
                disabled={deleting}
                type="button"
                aria-label="Delete comment"
              >
                <Trash2 size={14} />
              </button>
            )}
            {currentUserId && currentUserId !== comment.user.id && (
              <ReportButton targetType="comment" targetId={comment.id} variant="icon" />
            )}
          </div>
        </div>
      </div>

      {/* Reply compose */}
      {showReplyCompose && (
        <div className={styles.replyCompose}>
          <CommentCompose
            podcastId={podcastId}
            parentId={comment.id}
            onSubmit={handleReplySubmit}
            onCancel={() => setShowReplyCompose(false)}
            placeholder="Write a reply..."
          />
        </div>
      )}

      {/* Nested replies (one level only) */}
      {showReplies && replies.length > 0 && (
        <div className={styles.replies}>
          {replies.map((reply) => (
            <div key={reply.id} className={styles.replyCard}>
              <div className={styles.main}>
                <Link
                  href={reply.user.handle ? `/profile/handle/${reply.user.handle}` : `/profile/${reply.user.id}`}
                  className={styles.avatar}
                  aria-label={`View ${reply.user.name || 'user'} profile`}
                >
                  {reply.user.image ? (
                    <Image
                      src={reply.user.image}
                      alt=""
                      width={24}
                      height={24}
                      className={styles.avatarImg}
                    />
                  ) : (
                    <span className={styles.avatarFallback} data-size="small">
                      {(reply.user.name || '?')[0].toUpperCase()}
                    </span>
                  )}
                </Link>

                <div className={styles.body}>
                  <div className={styles.header}>
                    <Link
                      href={reply.user.handle ? `/profile/handle/${reply.user.handle}` : `/profile/${reply.user.id}`}
                      className={styles.authorName}
                    >
                      {reply.user.name || 'Anonymous'}
                    </Link>
                    <span className={styles.time}>{formatRelativeTime(reply.createdAt)}</span>
                    {reply.timestamp !== null && reply.timestamp !== undefined && (
                      <span className={styles.timestampBadge} aria-label={`At ${formatTimestamp(reply.timestamp)}`}>
                        {formatTimestamp(reply.timestamp)}
                      </span>
                    )}
                  </div>
                  <p className={styles.content}>{reply.content}</p>
                  <div className={styles.footer}>
                    {(currentUserId === reply.user.id || currentUserId === podcastOwnerId) && (
                      <button
                        className={styles.deleteBtn}
                        onClick={async () => {
                          const response = await fetch(
                            `/api/podcasts/${podcastId}/comments/${reply.id}`,
                            { method: 'DELETE' }
                          );
                          if (response.ok) {
                            handleReplyDelete(reply.id);
                          }
                        }}
                        type="button"
                        aria-label="Delete reply"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
