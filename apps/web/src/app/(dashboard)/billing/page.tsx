import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getFreeTierStatus } from '@/lib/generation-gate';
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

  const [ttsKeys, aiKeys, podcastCount, freeTier] = await Promise.all([
    listByokProviders(userId),
    listAiProviders(userId),
    prisma.podcast.count({ where: { userId } }),
    getFreeTierStatus(userId),
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
            AI is free &mdash; <Link href="/settings">add your own key</Link> to choose a different model.
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
            <Link href="/settings">Add one in Settings</Link> for unlimited generation.
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

      {/* Free Tier */}
      {!freeTier.isByokUser && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Free Tier</h2>
          <div className={styles.creditCard}>
            <div className={styles.creditBalance}>
              {freeTier.freeGenerationsRemaining}/{freeTier.freeGenerationsLimit}
            </div>
            <div className={styles.creditMeta}>
              <span>free generations remaining</span>
            </div>
          </div>
          {freeTier.freeGenerationsRemaining === 0 && (
            <p className={styles.manageText}>
              You&apos;ve used all your free generations.{' '}
              <Link href="/onboarding?step=keys">Add a voice provider key</Link> for unlimited access.
            </p>
          )}
        </section>
      )}

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
            Start with free podcasts, then add a voice provider key for unlimited generation.
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
