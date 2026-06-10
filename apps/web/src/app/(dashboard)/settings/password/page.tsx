import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ChangePasswordForm } from '@/components/account/ChangePasswordForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Password' };

/**
 * Change-password screen. Any signed-in learner can set a new password here. We
 * read forcePasswordChange directly (the session does not carry it) so a member
 * created by the owner, or one whose password was reset, sees a clear banner
 * telling them they must set a new password. This page never blocks other
 * routes; it only surfaces the requirement when the learner lands here.
 */
export default async function PasswordPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/settings/password');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { forcePasswordChange: true, passwordHash: true },
  });

  // A learner with no local password (OAuth-only) has nothing to change here.
  if (!user?.passwordHash) {
    redirect('/settings');
  }

  const mustChange = user.forcePasswordChange;

  return (
    <main className={styles.main}>
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Password</h1>
        <p className={styles.introText}>
          Set a new password for your local account. You will keep your current session, so you
          will not be signed out.
        </p>
      </header>

      {mustChange && (
        <div className={styles.banner} role="status">
          <span className={styles.bannerIcon} aria-hidden="true">
            <LockGlyph />
          </span>
          <div className={styles.bannerBody}>
            <p className={styles.bannerTitle}>You must set a new password.</p>
            <p className={styles.bannerText}>
              Your account was set up with a temporary password. Choose your own to finish setting
              up.
            </p>
          </div>
        </div>
      )}

      <section className={styles.card} aria-labelledby="password-heading">
        <h2 id="password-heading" className={styles.cardTitle}>
          Change password
        </h2>
        <ChangePasswordForm
          forced={mustChange}
          redirectTo={mustChange ? '/learn' : undefined}
        />
      </section>
    </main>
  );
}

function LockGlyph() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={3} y={11} width={18} height={10} rx={2} />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
