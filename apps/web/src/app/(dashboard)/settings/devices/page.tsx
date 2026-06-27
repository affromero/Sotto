import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTailscaleReachStatus } from '@/lib/tailscale-reach';
import { DeviceReach } from './DeviceReach';
import { DeviceConnect } from './DeviceConnect';
import { ApiKeyManager } from './ApiKeyManager';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect a device' };

export default async function DevicesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login?callbackUrl=/settings/devices');
  }

  const isOwner = session.user.role === 'ADMIN';
  const tailscaleStatus = await getTailscaleReachStatus(3000);

  const keys = isOwner
    ? await prisma.apiKey.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          lastUsedAt: true,
          createdAt: true,
          revokedAt: true,
        },
      })
    : [];

  const serializedKeys = keys.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
    revokedAt: k.revokedAt?.toISOString() ?? null,
  }));

  return (
    <main className={styles.main}>
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Connect a device</h1>
        <p className={styles.introText}>
          Use Sotto on a phone or tablet in two steps: open this server from the other device, then
          pair the app to your account.
        </p>
      </header>

      <section className={styles.step} aria-labelledby="reach-heading">
        <div className={styles.stepHead}>
          <span className={styles.stepNum} aria-hidden="true">
            1
          </span>
          <div>
            <h2 id="reach-heading" className={styles.stepTitle}>
              Open this server in a browser
            </h2>
            <p className={styles.stepText}>
              This QR opens Sotto in Safari or Chrome. The native iPad app needs the separate
              pairing QR in Step 2.
            </p>
          </div>
        </div>
        <DeviceReach initialStatus={tailscaleStatus} canSetUp={isOwner} />
      </section>

      <section className={styles.step} aria-labelledby="pair-heading">
        <div className={styles.stepHead}>
          <span className={styles.stepNum} aria-hidden="true">
            2
          </span>
          <div>
            <h2 id="pair-heading" className={styles.stepTitle}>
              Pair the native app
            </h2>
            <p className={styles.stepText}>
              Generate a one-time code and scan it from the Sotto app to sign in on the new device.
            </p>
          </div>
        </div>
        <DeviceConnect reachUrl={tailscaleStatus.serveUrl} />
      </section>

      {isOwner && (
        <section className={styles.keysSection} aria-labelledby="keys-heading">
          <div className={styles.keysHead}>
            <h2 id="keys-heading" className={styles.stepTitle}>
              API keys for clients and scripts
            </h2>
            <p className={styles.stepText}>
              Beyond phones and tablets, an API key lets the Sotto terminal app, a local agent such
              as Claude Code or Codex, or your own script reach this server over HTTP. Send the key
              as a Bearer token:
            </p>
          </div>
          <pre className={styles.codeBlock}>
            <code>{`curl -H "Authorization: Bearer sk_sotto_…" \\\n  https://your-sotto.example/api/v1/courses`}</code>
          </pre>
          <p className={styles.keysDocLink}>
            See the{' '}
            <Link href="/developers" className={styles.inlineLink}>
              API reference
            </Link>{' '}
            for every endpoint.
          </p>
          <ApiKeyManager initialKeys={serializedKeys} />
        </section>
      )}
    </main>
  );
}
