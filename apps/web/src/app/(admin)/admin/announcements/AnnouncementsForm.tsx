'use client';

import { useState } from 'react';
import styles from './page.module.css';

interface AnnouncementsFormProps {
  userCount: number;
}

export function AnnouncementsForm({ userCount }: AnnouncementsFormProps) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');

    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.formErrors?.[0] ?? 'Failed to send announcement');
      }

      setStatus('success');
      setSubject('');
      setMessage('');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="announcement-subject" className={styles.label}>
          Subject
        </label>
        <input
          id="announcement-subject"
          type="text"
          className={styles.input}
          placeholder="e.g. New feature: voice cloning is now free"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
          disabled={status === 'sending'}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="announcement-message" className={styles.label}>
          Message
        </label>
        <textarea
          id="announcement-message"
          className={styles.textarea}
          placeholder="Write your announcement here. This will appear in-app, as a push notification, and in email for users who have opted in."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={5000}
          rows={8}
          required
          disabled={status === 'sending'}
        />
        <p className={styles.charCount}>{message.length} / 5000</p>
      </div>

      {status === 'success' && (
        <div className={styles.banner} data-variant="success">
          Announcement queued — {userCount.toLocaleString()} users will be notified.
        </div>
      )}

      {status === 'error' && (
        <div className={styles.banner} data-variant="error">
          {errorMsg}
        </div>
      )}

      <button
        type="submit"
        className={styles.submitButton}
        disabled={status === 'sending' || !subject.trim() || !message.trim()}
      >
        {status === 'sending' ? 'Queuing…' : `Send to all ${userCount.toLocaleString()} users`}
      </button>
    </form>
  );
}
