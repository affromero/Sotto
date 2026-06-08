import styles from './page.module.css';

export const metadata = {
  title: 'Account Banned — Sotto',
  robots: { index: false, follow: false },
};

export default function BannedPage() {
  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Account Banned</h1>
        <p className={styles.message}>
          Your account has been banned for violating our community guidelines.
        </p>
        <p className={styles.detail}>
          If you believe this was a mistake, please contact us at{' '}
          <a href="mailto:support@example.com" className={styles.link}>
            support@example.com
          </a>{' '}
          with your account email and we will review your case.
        </p>
      </div>
    </main>
  );
}
