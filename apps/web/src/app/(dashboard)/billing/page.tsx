import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { Badge } from '@/components/ui/Badge';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API Keys & Usage' };

export default async function BillingPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [ttsKeys, aiKeys, podcastCount] = await Promise.all([
    listByokProviders(userId),
    listAiProviders(userId),
    prisma.podcast.count({ where: { userId } }),
  ]);

  const hasAnyKey = ttsKeys.length > 0 || aiKeys.length > 0;

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>API Keys & Usage</h1>

      {/* AI Provider Keys */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>AI Provider Keys</h2>
        {aiKeys.length === 0 ? (
          <p className={styles.placeholder}>
            No AI keys configured.{' '}
            <Link href="/settings">Add one in Settings</Link> to start generating podcasts.
          </p>
        ) : (
          <div className={styles.historyTable}>
            {aiKeys.map((key) => (
              <div key={key.provider} className={styles.historyRow}>
                <div className={styles.historyInfo}>
                  <span className={styles.historyDesc}>{key.label || key.provider}</span>
                </div>
                <Badge variant={key.isValid ? 'success' : 'error'}>
                  {key.isValid ? 'Active' : 'Invalid'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* TTS Provider Keys */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>TTS Provider Keys</h2>
        {ttsKeys.length === 0 ? (
          <p className={styles.placeholder}>
            No TTS keys configured.{' '}
            <Link href="/settings">Add one in Settings</Link> for voice generation.
          </p>
        ) : (
          <div className={styles.historyTable}>
            {ttsKeys.map((key) => (
              <div key={key.provider} className={styles.historyRow}>
                <div className={styles.historyInfo}>
                  <span className={styles.historyDesc}>{key.label || key.provider}</span>
                </div>
                <Badge variant={key.isValid ? 'success' : 'error'}>
                  {key.isValid ? 'Active' : 'Invalid'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Usage Stats */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Usage</h2>
        <div className={styles.creditCard}>
          <div className={styles.creditBalance}>{podcastCount}</div>
          <div className={styles.creditMeta}>
            <span>podcasts generated</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      {!hasAnyKey && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Get Started</h2>
          <p className={styles.manageText}>
            Sotto is free and BYOK (Bring Your Own Key). Add your AI and TTS API keys in Settings to
            start generating podcasts.
          </p>
          <div className={styles.manageActions}>
            <Link href="/settings" className={styles.planName}>
              Go to Settings
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
