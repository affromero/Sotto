import { redirect } from 'next/navigation';
import { isSelfHosted } from '@/lib/self-hosted';
import { getSiteConfig } from '@/lib/site-config';
import { AuthButtons } from '../AuthButtons';
import styles from '../login/page.module.css';

export const metadata = {
  title: 'Get started',
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  // A self-hosted instance has no public signup: the first visitor creates the
  // owner profile, and the owner adds household members. Send people to the
  // profile screen instead of an invite-only dead end.
  if (isSelfHosted()) {
    redirect('/auth/login');
  }

  const { openSignup } = await getSiteConfig();

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {openSignup ? (
          <>
            <h1 className={styles.title}>Create your account</h1>
            <p className={styles.subtitle}>
              Connect a provider and start learning a language in your own context.
            </p>
            <AuthButtons />
          </>
        ) : (
          <>
            <h1 className={styles.title}>Join Sotto</h1>
            <p className={styles.subtitle}>
              This managed instance is not open for new accounts right now. Sotto is open source
              and self-hostable, so you can also run your own.
            </p>
          </>
        )}
        <p className={styles.footer}>
          Already set up? <a href="/auth/login">Open your profiles</a>
        </p>
      </div>
    </main>
  );
}
