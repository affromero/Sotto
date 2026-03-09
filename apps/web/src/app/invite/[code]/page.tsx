import { prisma } from '@/lib/prisma';
import { InviteForm } from './InviteForm';
import styles from './page.module.css';

export const metadata = {
  title: 'You\'re Invited to Sotto',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function InvitePage({ params }: PageProps) {
  const { code } = await params;

  const invitation = await prisma.invitationLink.findUnique({
    where: { code },
  });

  const now = new Date();

  if (!invitation) {
    return (
      <main className={styles.main}>
        <div className={styles.errorContainer}>
          <h1 className={styles.errorTitle}>Invalid Invitation</h1>
          <p className={styles.errorMessage}>This invitation link is not valid.</p>
          <a href="/" className={styles.homeLink}>Go to Sotto</a>
        </div>
      </main>
    );
  }

  if (invitation.usedAt) {
    return (
      <main className={styles.main}>
        <div className={styles.errorContainer}>
          <h1 className={styles.errorTitle}>Already Used</h1>
          <p className={styles.errorMessage}>This invitation has already been redeemed.</p>
          <a href="/auth/login" className={styles.homeLink}>Sign in</a>
        </div>
      </main>
    );
  }

  if (!invitation.enabled) {
    return (
      <main className={styles.main}>
        <div className={styles.errorContainer}>
          <h1 className={styles.errorTitle}>Invitation Disabled</h1>
          <p className={styles.errorMessage}>This invitation has been disabled.</p>
          <a href="/" className={styles.homeLink}>Go to Sotto</a>
        </div>
      </main>
    );
  }

  if (invitation.expiresAt < now) {
    return (
      <main className={styles.main}>
        <div className={styles.errorContainer}>
          <h1 className={styles.errorTitle}>Invitation Expired</h1>
          <p className={styles.errorMessage}>This invitation has expired. Ask the sender for a new one.</p>
          <a href="/" className={styles.homeLink}>Go to Sotto</a>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>You&apos;re Invited to Sotto</h1>
        <p className={styles.subtitle}>Enter the email you&apos;ll use to sign in with Google or Apple</p>
        <InviteForm code={code} />
      </div>
    </main>
  );
}
