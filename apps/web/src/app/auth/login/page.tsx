import { redirect } from 'next/navigation';
import { Newsreader, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { auth } from '@/lib/auth';
import { isOpenSignup } from '@/lib/site-config';
import { isLocalAuthEnabled } from '@/lib/local-auth';
import { ProfilePicker } from '@/components/auth/ProfilePicker';
import { AuthButtons } from '../AuthButtons';
import styles from './page.module.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['400', '500'],
  variable: '--font-newsreader',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

export const metadata = {
  title: 'Sign In',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ returning?: string; oauth?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const session = await auth();

  // Self-hosted local sign-in: the Netflix-style profile picker, unless OAuth was
  // explicitly requested via ?oauth=1. This bypasses the waitlist entirely, since a
  // self-hosted instance has no waitlist. Fonts are wired here so the picker's aula
  // tokens (--font-newsreader / -ibm-plex-*) resolve, the same way welcome does.
  if (params.oauth !== '1' && (await isLocalAuthEnabled())) {
    return (
      <div
        className={`${newsreader.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable}`}
      >
        <ProfilePicker />
      </div>
    );
  }

  // OAuth path: not signed in + signup closed + not a returning user → waitlist.
  if (!session && !params.returning && !(await isOpenSignup())) {
    redirect('/auth/waitlisted');
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
