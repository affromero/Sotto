'use client';

import { useCallback, useRef, useState } from 'react';
import styles from './CommentCompose.module.css';

export interface CommentData {
  id: string;
  content: string;
  timestamp: number | null;
  replyCount: number;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    handle: string | null;
  };
}

interface CommentComposeProps {
  podcastId: string;
  parentId?: string;
  onSubmit: (comment: CommentData) => void;
  onCancel?: () => void;
  placeholder?: string;
}

export function CommentCompose({
  podcastId,
  parentId,
  onSubmit,
  onCancel,
  placeholder = 'Add a comment...',
}: CommentComposeProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch(`/api/podcasts/${podcastId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: trimmed,
          ...(parentId ? { parentId } : {}),
        }),
      });

      if (!response.ok) return;

      const comment: CommentData = await response.json();
      onSubmit(comment);
      setContent('');

      // Reset textarea height
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
      }
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, podcastId, parentId, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className={`${styles.root} ${parentId ? styles.reply : ''}`}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        maxLength={2000}
        aria-label={parentId ? 'Write a reply' : 'Write a comment'}
      />
      <div className={styles.actions}>
        {parentId && onCancel && (
          <button
            className={styles.cancelBtn}
            onClick={onCancel}
            type="button"
            aria-label="Cancel reply"
          >
            Cancel
          </button>
        )}
        <button
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={!content.trim() || submitting}
          type="button"
          aria-label="Post comment"
        >
          {submitting ? 'Posting...' : 'Post'}
        </button>
      </div>
    </div>
  );
}
