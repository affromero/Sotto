'use client';

import { useCallback, useRef, useState } from 'react';
import { Flag, Check, X } from 'lucide-react';
import styles from './ClaimFlagButton.module.css';

interface ClaimFlagButtonProps {
  podcastId: string;
  turnIndex: number;
  turnText: string;
  disabled?: boolean;
}

export function ClaimFlagButton({ podcastId, turnIndex, turnText, disabled }: ClaimFlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'duplicate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleToggle = useCallback(() => {
    if (result) return;
    setOpen((prev) => {
      if (!prev) {
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
      return !prev;
    });
  }, [result]);

  const handleSubmit = useCallback(async () => {
    if (description.length < 10) {
      setError('Please describe the issue (at least 10 characters)');
      return;
    }

    setSubmitting(true);
    setError(null);

    const response = await fetch(`/api/podcasts/${podcastId}/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnIndex, turnText, description }),
    });

    if (response.ok) {
      setResult('success');
      setOpen(false);
    } else if (response.status === 409) {
      setResult('duplicate');
      setOpen(false);
    } else {
      const data = await response.json();
      setError(typeof data.error === 'string' ? data.error : 'Failed to submit');
    }

    setSubmitting(false);
  }, [podcastId, turnIndex, turnText, description]);

  if (result === 'success') {
    return (
      <span className={styles.resultIcon} title="Claim flagged" aria-label="Claim flagged">
        <Check size={14} />
      </span>
    );
  }

  if (result === 'duplicate') {
    return (
      <span className={styles.resultIcon} title="Already flagged" aria-label="Already flagged">
        <Check size={14} />
      </span>
    );
  }

  return (
    <span className={styles.wrapper}>
      <button
        type="button"
        className={styles.flagBtn}
        onClick={handleToggle}
        disabled={disabled || submitting}
        title="Flag inaccurate claim"
        aria-label="Flag inaccurate claim"
        aria-expanded={open}
      >
        <Flag size={14} />
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Report inaccurate claim">
          <div className={styles.popoverHeader}>
            <span className={styles.popoverTitle}>Flag inaccurate claim</span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why do you think this claim is inaccurate?"
            rows={3}
            maxLength={2000}
            disabled={submitting}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="button"
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={submitting || description.length < 10}
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      )}
    </span>
  );
}
