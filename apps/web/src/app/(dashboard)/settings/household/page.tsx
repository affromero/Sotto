import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { HouseholdManager } from './HouseholdManager';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Household' };

export default async function HouseholdPage() {
  const session = await auth();

  // Owner-only: gate on the session role exactly like requireAdmin() does.
  // Stays ADMIN during impersonation, so the owner keeps access.
  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/settings/household');
  }
  if (session.user.role !== 'ADMIN') {
    redirect('/settings');
  }

  return (
    <main className={styles.main}>
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Household</h1>
        <p className={styles.introText}>
          Everyone under your roof learns on their own private account. Invite a family member
          and they join this instance as a fully separate learner.
        </p>
      </header>
      <HouseholdManager />
    </main>
  );
}
