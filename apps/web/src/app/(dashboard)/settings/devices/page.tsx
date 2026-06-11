import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { DeviceReach } from './DeviceReach';
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
          Use Sotto on a phone or tablet in two steps: open this server from the other device,
          then pair the app to your account.
        </p>
      </header>

      <section className={styles.step} aria-labelledby="reach-heading">
        <div className={styles.stepHead}>
          <span className={styles.stepNum} aria-hidden="true">
            1
          </span>
          <div>
            <h2 id="reach-heading" className={styles.stepTitle}>
              Open this server
            </h2>
            <p className={styles.stepText}>
              Scan to reach Sotto on the same network, or follow the guided steps for a private
              tunnel when you are away from home.
            </p>
          </div>
        </div>
        <DeviceReach />
      </section>

      <section className={styles.step} aria-labelledby="pair-heading">
        <div className={styles.stepHead}>
          <span className={styles.stepNum} aria-hidden="true">
            2
          </span>
          <div>
            <h2 id="pair-heading" className={styles.stepTitle}>
              Pair the app
            </h2>
            <p className={styles.stepText}>
              Generate a one-time code and scan it from the Sotto app to sign in on the new device.
            </p>
          </div>
        </div>
        <DeviceConnect />
      </section>
    </main>
  );
}
