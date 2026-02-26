'use client';

import { useWaitlist } from './WaitlistProvider';
import styles from './WaitlistForm.module.css';

interface WaitlistFormProps {
  source: string;
}

export function WaitlistForm({ source }: WaitlistFormProps) {
  const { email, setEmail, twitter, setTwitter, wishlist, setWishlist, loading, error, handleSubmit } = useWaitlist();

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
          placeholder="What would you love to see in Sotto? (optional)"
          value={wishlist}
          onChange={(e) => setWishlist(e.target.value)}
          maxLength={500}
          rows={2}
          aria-label="Feature wishlist"
        />
        <div className={styles.actions}>
          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? 'Joining...' : 'Join the Waitlist'}
          </button>
          <a
            href="https://discord.gg/Dm4T42RXa"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.discord}
            aria-label="Join our Discord"
          >
            <svg width="20" height="16" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
              <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5a.2.2 0 00-.1 0A60.4 60.4 0 00.5 45.2a.3.3 0 000 .2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.6 38.6 0 01-5.5-2.7.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.3 36.3 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3 0A58.5 58.5 0 0070 45.4a.2.2 0 000-.2A60 60 0 0060.2 5a.2.2 0 00-.1 0zM23.7 37.1c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1 6.5 3.2 6.4 7.1c0 3.9-2.8 7.1-6.4 7.1zm23.6 0c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1 6.5 3.2 6.4 7.1c0 3.9-2.8 7.1-6.4 7.1z" />
            </svg>
            Join Discord
          </a>
        </div>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
