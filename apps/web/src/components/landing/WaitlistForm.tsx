'use client';

import { useWaitlist } from './WaitlistProvider';
import styles from './WaitlistForm.module.css';

interface WaitlistFormProps {
  source: string;
}

export function WaitlistForm({ source }: WaitlistFormProps) {
  const { email, setEmail, twitter, setTwitter, feedback, setFeedback, loading, error, handleSubmit } = useWaitlist();

  return (
    <>
      <form className={styles.form} onSubmit={(e) => handleSubmit(e, source)}>
        <input
          className={styles.input}
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-label="Email address"
        />
        <div className={styles.inputWrapper}>
          <input
            className={styles.input}
            type="text"
            placeholder="@twitter (optional)"
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
            aria-label="Twitter handle"
            title="So we can DM you early access and keep you in the loop"
          />
          <span className={styles.inputHint}>So we can DM you early access</span>
        </div>
        <textarea
          className={styles.textarea}
          placeholder="What features would you love to see? (optional)"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          maxLength={500}
          rows={2}
          aria-label="Feature requests or feedback"
        />
        <button className={styles.submit} type="submit" disabled={loading}>
          {loading ? 'Joining...' : 'Join the Waitlist'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
