import { isLocalAuthEnabled } from '@/lib/local-auth';
import { ProfilePicker } from '@/components/auth/ProfilePicker';
import { AuthButtons } from '../AuthButtons';
import styles from './page.module.css';

export const metadata = {
  title: 'Sign In',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ oauth?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Self-hosted local sign-in: the Netflix-style profile picker, unless OAuth was
  // explicitly requested via ?oauth=1.
  if (params.oauth !== '1' && (await isLocalAuthEnabled())) {
    return (
      <div>
        <ProfilePicker />
      </div>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Welcome back to Sotto</h1>
        <p className={styles.subtitle}>Sign in to continue your courses</p>
        <AuthButtons />
        <p className={styles.footer}>
          Don&apos;t have an account? <a href="/auth/signup">Sign up</a>
        </p>
      </div>
    </main>
  );
}
