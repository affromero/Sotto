import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { DeviceConnect } from './DeviceConnect';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect a device' };

export default async function DevicesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/settings/devices');
  }

  return (
    <main className={styles.main}>
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Connect a device</h1>
        <p className={styles.introText}>
          Scan this code from the Sotto app on your phone or tablet to link it to your account on
          this server — nothing to type. The code is valid for a few minutes and works once.
        </p>
      </header>
      <DeviceConnect />
    </main>
  );
}
