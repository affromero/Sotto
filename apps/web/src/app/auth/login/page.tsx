import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isOpenSignup } from '@/lib/site-config';
import { AuthButtons } from '../AuthButtons';
import styles from './page.module.css';

export const metadata = {
  title: 'Sign In',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ returning?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const session = await auth();

  // Not signed in + signup closed + not a returning user → waitlist
  if (!session && !params.returning && !await isOpenSignup()) {
    redirect('/auth/waitlisted');
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Welcome Back to Sotto</h1>
        <p className={styles.subtitle}>Sign in to continue creating and listening</p>
        <AuthButtons />
        <p className={styles.footer}>
          Don&apos;t have an account? <a href="/auth/signup">Sign up</a>
        </p>
      </div>
    </main>
  );
}
