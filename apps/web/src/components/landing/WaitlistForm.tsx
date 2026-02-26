'use client';

import { useWaitlist } from './WaitlistProvider';
import styles from './WaitlistForm.module.css';

interface WaitlistFormProps {
  source: string;
}

export function WaitlistForm({ source }: WaitlistFormProps) {
  const { email, setEmail, twitter, setTwitter, loading, error, handleSubmit } = useWaitlist();

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
        <input
          className={styles.input}
          type="text"
          placeholder="@twitter (optional)"
          value={twitter}
          onChange={(e) => setTwitter(e.target.value)}
          aria-label="Twitter handle"
        />
        <button className={styles.submit} type="submit" disabled={loading}>
          {loading ? 'Joining...' : 'Join the Waitlist'}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
