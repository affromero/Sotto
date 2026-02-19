import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';
import { FeedbackForm } from './FeedbackForm';

export const metadata = {
  title: 'Share Your Thoughts',
  description: 'Help shape the future of Sotto. Your feedback is invaluable.',
};

export default function FeedbackPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <span className={styles.badge}>Early Access</span>
          <h1 className={styles.title}>Your Voice Matters</h1>
          <p className={styles.subtitle}>
            You&apos;re one of the first people to experience Sotto. Every piece of feedback
            you share directly shapes what we build next. We read every single message.
          </p>
        </header>

        <div className={styles.promise}>
          <div className={styles.promiseItem}>
            <span className={styles.promiseIcon}>🔒</span>
            <div>
              <strong>Private & Respected</strong>
              <p>Your feedback is never shared publicly. It&apos;s between you and our team.</p>
            </div>
          </div>
          <div className={styles.promiseItem}>
            <span className={styles.promiseIcon}>⚡</span>
            <div>
              <strong>We Act Fast</strong>
              <p>Early feedback gets priority. Most suggestions are reviewed within 24 hours.</p>
            </div>
          </div>
          <div className={styles.promiseItem}>
            <span className={styles.promiseIcon}>💬</span>
            <div>
              <strong>You&apos;ll Hear Back</strong>
              <p>If you leave your email, we&apos;ll personally follow up on your feedback.</p>
            </div>
          </div>
        </div>

        <FeedbackForm />

        <footer className={styles.footer}>
          <p>
            Prefer a conversation? Email us directly at{' '}
            <a href="mailto:hello@sotto.fm">hello@sotto.fm</a>
          </p>
        </footer>
      </div>
    </main>
      <Footer />
    </>
  );
}
