import Link from 'next/link';
import styles from './page.module.css';

export const metadata = {
  title: 'Waitlisted',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ reason?: string }>;
}

const MESSAGES: Record<string, { title: string; body: string }> = {
  'not-on-list': {
    title: 'Join the waitlist first',
    body: 'Sign-up is currently invite-only. Join the waitlist on our homepage and we\'ll let you know when your spot is ready.',
  },
  pending: {
    title: 'You\'re on the waitlist!',
    body: 'We\'ll email you when your spot is ready. Keep an eye on your inbox.',
  },
  'no-email': {
    title: 'We couldn\'t get your email',
    body: 'That sign-in provider didn\'t share an email address. Please try a different provider (Google, GitHub, or Apple).',
  },
};

const DEFAULT_MESSAGE = {
  title: 'Sign-up is invite-only',
  body: 'Join the waitlist on our homepage to get access.',
};

export default async function WaitlistedPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { title, body } = MESSAGES[params.reason ?? ''] ?? DEFAULT_MESSAGE;

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>{body}</p>
        <div className={styles.links}>
          <Link href="/" className={styles.primaryLink}>
            Back to Homepage
          </Link>
          <Link href="/auth/login" className={styles.secondaryLink}>
            Try a different provider
          </Link>
        </div>
      </div>
    </main>
  );
}
