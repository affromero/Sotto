import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SettingsForm } from './SettingsForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [user, accounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        image: true,
        bio: true,
      },
    }),
    prisma.account.findMany({
      where: { userId },
      select: {
        provider: true,
      },
    }),
  ]);

  if (!user) return null;

  const connectedProviders = accounts.map((a) => a.provider);

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>Settings</h1>

      <SettingsForm
        initialName={user.name ?? ''}
        initialBio={user.bio ?? ''}
        email={user.email}
        image={user.image}
        connectedProviders={connectedProviders}
      />
    </main>
  );
}
