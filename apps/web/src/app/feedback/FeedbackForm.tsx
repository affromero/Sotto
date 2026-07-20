'use client';

import { useState } from 'react';
import styles from './FeedbackForm.module.css';

type FeedbackType = 'GENERAL' | 'BUG' | 'FEATURE_REQUEST' | 'PRAISE' | 'CONCERN';

const FEEDBACK_TYPES: Array<{ value: FeedbackType; label: string; emoji: string }> = [
  { value: 'GENERAL', label: 'General Thoughts', emoji: '💭' },
  { value: 'FEATURE_REQUEST', label: 'Feature Idea', emoji: '💡' },
  { value: 'BUG', label: 'Something Broken', emoji: '🐛' },
  { value: 'PRAISE', label: 'Something Great', emoji: '✨' },
  { value: 'CONCERN', label: 'A Concern', emoji: '🤔' },
];

export function FeedbackForm() {
  const [type, setType] = useState<FeedbackType>('GENERAL');
  const [rating, setRating] = useState<number>(0);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          rating: rating || undefined,
          subject,
          message,
          email: email || undefined,
          name: name || undefined,
        }),
      });

      if (response.ok) {
        setSubmitted(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className={styles.success}>
        <span className={styles.successIcon}>🙏</span>
        <h2>Thank you</h2>
        <p>Your feedback means the world to us. We&apos;ll review it carefully and take action.</p>
        {email && (
          <p className={styles.successNote}>
            We&apos;ll follow up at <strong>{email}</strong>
          </p>
        )}
        <button
          className={styles.resetBtn}
          onClick={() => {
            setSubmitted(false);
            setSubject('');
            setMessage('');
            setRating(0);
          }}
        >
          Share more feedback
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {/* Type Selection */}
      <div className={styles.field}>
        <label className={styles.label}>What kind of feedback?</label>
        <div className={styles.typeGrid}>
          {FEEDBACK_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`${styles.typeBtn} ${type === t.value ? styles.typeBtnActive : ''}`}
              onClick={() => setType(t.value)}
            >
              <span>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Rating */}
      <div className={styles.field}>
        <label className={styles.label}>How&apos;s your experience so far?</label>
        <div className={styles.stars}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={`${styles.star} ${star <= rating ? styles.starActive : ''}`}
              onClick={() => setRating(star)}
              aria-label={`${star} star${star > 1 ? 's' : ''}`}
            >
              ★
            </button>
          ))}
          {rating > 0 && (
            <span className={styles.ratingLabel}>
              {rating === 1 && 'Needs work'}
              {rating === 2 && 'Below expectations'}
              {rating === 3 && 'Decent'}
              {rating === 4 && 'Really good'}
              {rating === 5 && 'Exceptional'}
            </span>
          )}
        </div>
      </div>

      {/* Subject */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="subject">
          Subject <span className={styles.required}>*</span>
        </label>
        <input
          id="subject"
          className={styles.input}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Brief summary of your feedback"
          required
          maxLength={200}
        />
      </div>

      {/* Message */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="message">
          Tell us more <span className={styles.required}>*</span>
        </label>
        <textarea
          id="message"
          className={styles.textarea}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Share as much detail as you'd like. What worked? What didn't? What would you change?"
          required
          rows={6}
          maxLength={5000}
        />
        <span className={styles.charCount}>{message.length}/5000</span>
      </div>

      {/* Optional contact info */}
      <div className={styles.contactSection}>
        <p className={styles.contactLabel}>Want us to follow up? (optional)</p>
        <div className={styles.contactGrid}>
          <div className={styles.field}>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={100}
            />
          </div>
          <div className={styles.field}>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email"
              maxLength={200}
              inputMode="email"
              autoComplete="email"
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        className={styles.submitBtn}
        disabled={submitting || !subject || !message}
      >
        {submitting ? 'Sending...' : 'Send Feedback'}
      </button>
    </form>
  );
}
