'use client';

import { useState } from 'react';
import styles from './ReportModal.module.css';

const REASONS = [
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'HATE_SPEECH', label: 'Hate Speech' },
  { value: 'VIOLENCE', label: 'Violence' },
  { value: 'SEXUAL_CONTENT', label: 'Sexual Content' },
  { value: 'MISINFORMATION', label: 'Misinformation' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'IMPERSONATION', label: 'Impersonation' },
  { value: 'COPYRIGHT', label: 'Copyright Violation' },
  { value: 'OTHER', label: 'Other' },
] as const;

interface ReportModalProps {
  targetType: 'podcast' | 'comment' | 'user';
  targetId: string;
  onClose: () => void;
}

export function ReportModal({ targetType, targetId, onClose }: ReportModalProps) {
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) {
      setError('Please select a reason.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          description: description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit report');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Report content">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {success ? (
          <div className={styles.successContent}>
            <h2 className={styles.title}>Report Submitted</h2>
            <p className={styles.successMessage}>
              Thank you for helping keep Sotto safe. We will review your report shortly.
            </p>
            <button className={styles.closeBtn} onClick={onClose} type="button">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 className={styles.title}>
              Report {targetType === 'podcast' ? 'Podcast' : targetType === 'comment' ? 'Comment' : 'User'}
            </h2>

            <fieldset className={styles.reasons}>
              <legend className={styles.label}>Why are you reporting this?</legend>
              {REASONS.map((r) => (
                <label key={r.value} className={styles.reasonOption}>
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className={styles.radio}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </fieldset>

            <label className={styles.label}>
              Additional details (optional)
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide any additional context..."
                maxLength={2000}
                rows={3}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className={styles.submitBtn} disabled={submitting || !reason}>
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
