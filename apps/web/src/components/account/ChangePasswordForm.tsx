'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import styles from './ChangePasswordForm.module.css';

const MIN_PASSWORD_LENGTH = 8;
const GENERIC_ERROR = 'We could not change your password. Please try again.';
const WRONG_CURRENT_ERROR = 'Current password is incorrect.';

interface ChangePasswordFormProps {
  /** Where to send the learner after a successful change. Defaults to no redirect. */
  redirectTo?: string;
  /** Whether the change is required before continuing (forced flow). */
  forced?: boolean;
}

/**
 * Self-service password change. Verifies the current password, checks the new
 * password against a min length and a live confirm match, then POSTs to
 * /api/account/password. A 403 surfaces inline as a wrong-current-password
 * message; any other failure stays generic. Passwords are never displayed in
 * plain text, logged, or echoed back. Embeddable anywhere a learner can change
 * their own password (settings, or the forced first-sign-in flow).
 */
export function ChangePasswordForm({ redirectTo, forced = false }: ChangePasswordFormProps) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const currentId = useId();
  const nextId = useId();
  const confirmId = useId();
  const hintId = useId();

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const reused = next.length > 0 && current.length > 0 && next === current;
  const passwordReady =
    next.length >= MIN_PASSWORD_LENGTH && confirm === next && next !== current;
  const canSubmit = current.length > 0 && passwordReady && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (res.ok) {
        setDone(true);
        setCurrent('');
        setNext('');
        setConfirm('');
        setSubmitting(false);
        if (redirectTo) {
          router.push(redirectTo);
          router.refresh();
        } else {
          router.refresh();
        }
        return;
      }
      setError(res.status === 403 ? WRONG_CURRENT_ERROR : GENERIC_ERROR);
      setSubmitting(false);
    } catch {
      setError(GENERIC_ERROR);
      setSubmitting(false);
    }
  }

  if (done && !redirectTo) {
    return (
      <div className={styles.confirmation} role="status">
        <span className={styles.confirmIcon} aria-hidden="true">
          <CheckGlyph />
        </span>
        <div>
          <p className={styles.confirmTitle}>Password updated.</p>
          <p className={styles.confirmText}>
            Your new password is active. Use it the next time you sign in.
          </p>
        </div>
      </div>
    );
  }

  const hintText = tooShort
    ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    : reused
      ? 'Choose a password different from your current one.'
      : mismatch
        ? 'Both new passwords need to match.'
        : passwordReady
          ? 'Looks good.'
          : `At least ${MIN_PASSWORD_LENGTH} characters, entered twice.`;
  const hintTone = tooShort || mismatch || reused ? styles.hintWarn : passwordReady ? styles.hintOk : '';

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={currentId}>
          Current password
        </label>
        <input
          id={currentId}
          className={styles.input}
          type="password"
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
            if (error) setError(null);
          }}
          disabled={submitting}
          autoComplete="current-password"
          autoCapitalize="off"
          spellCheck={false}
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={nextId}>
          New password
        </label>
        <input
          id={nextId}
          className={styles.input}
          type="password"
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
            if (error) setError(null);
          }}
          disabled={submitting}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={tooShort || reused ? true : undefined}
          aria-describedby={hintId}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={confirmId}>
          Confirm new password
        </label>
        <input
          id={confirmId}
          className={styles.input}
          type="password"
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
            if (error) setError(null);
          }}
          disabled={submitting}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={mismatch ? true : undefined}
          aria-describedby={hintId}
        />
      </div>

      <p id={hintId} className={`${styles.hint} ${hintTone}`} aria-live="polite">
        {hintText}
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={!canSubmit} loading={submitting}>
        {forced ? 'Set new password' : 'Change password'}
      </Button>
    </form>
  );
}

function CheckGlyph() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
