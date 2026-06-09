import { getSiteConfig } from '@/lib/site-config';
import { AuthButtons } from '../AuthButtons';
import styles from '../login/page.module.css';

export const metadata = {
  title: 'Sign Up',
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  const { openSignup } = await getSiteConfig();

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {openSignup ? (
          <>
            <h1 className={styles.title}>Create your account</h1>
            <p className={styles.subtitle}>
              Sign in to this instance and start learning a language in your own context.
            </p>
            <AuthButtons />
          </>
        ) : (
          <>
            <h1 className={styles.title}>Join Sotto</h1>
            <p className={styles.subtitle}>
              Sign-up is currently invite-only. <a href="/">Join the waitlist</a> to get access.
            </p>
          </>
        )}
        <p className={styles.footer}>
          Already have an account? <a href="/auth/login">Sign in</a>
        </p>
      </div>
    </main>
  );
}
