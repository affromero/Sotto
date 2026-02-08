import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BillingActions } from './BillingActions';
import { Badge } from '@/components/ui/Badge';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Billing' };

const tierPrices: Record<string, number> = {
  FREE: 0,
  PRO: 19,
  TEAM: 49,
};

const tierFeatures: Record<string, string[]> = {
  FREE: [
    '3 podcasts per month',
    'Up to 10 minutes each',
    '3 interactions per podcast',
    'Public podcasts only',
    'Community feed access',
  ],
  PRO: [
    '20 podcasts per month',
    'Up to 30 minutes each',
    'Unlimited interactions',
    'Private & unlisted podcasts',
    'Download MP3s',
    'Priority support',
  ],
  TEAM: [
    'Unlimited podcasts',
    'Up to 30 minutes each',
    'Unlimited interactions',
    'Private team feed',
    '10 team seats',
    'API access',
    'Analytics dashboard',
    'Priority support',
  ],
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function BillingPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      podcastsUsed: true,
      podcastsAllowed: true,
      subscription: {
        select: {
          tier: true,
          status: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      },
    },
  });

  if (!user) return null;

  const tier = user.subscription?.tier || 'FREE';
  const status = user.subscription?.status || 'ACTIVE';
  const periodEnd = user.subscription?.currentPeriodEnd;
  const cancelAtPeriodEnd = user.subscription?.cancelAtPeriodEnd ?? false;
  const podcastsUsed = user.podcastsUsed;
  const podcastsAllowed = user.podcastsAllowed;
  const price = tierPrices[tier] ?? 0;
  const features = tierFeatures[tier] ?? [];

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>Billing</h1>

      {/* Current Plan */}
      <section className={styles.section}>
        <div className={styles.planHeader}>
          <div className={styles.planInfo}>
            <h2 className={styles.sectionTitle}>Current Plan</h2>
            <div className={styles.planNameRow}>
              <span className={styles.planName}>{tier.charAt(0) + tier.slice(1).toLowerCase()}</span>
              <Badge variant={status === 'ACTIVE' ? 'success' : status === 'CANCELED' ? 'error' : 'warning'}>
                {cancelAtPeriodEnd ? 'Canceling' : status.charAt(0) + status.slice(1).toLowerCase()}
              </Badge>
            </div>
            {price > 0 && (
              <p className={styles.planPrice}>
                <span className={styles.priceAmount}>${price}</span>
                <span className={styles.priceInterval}>/month</span>
              </p>
            )}
            {price === 0 && (
              <p className={styles.planPrice}>
                <span className={styles.priceAmount}>Free</span>
              </p>
            )}
          </div>
        </div>

        {periodEnd && (
          <p className={styles.periodInfo}>
            {cancelAtPeriodEnd
              ? `Your plan will be canceled on ${formatDate(periodEnd)}`
              : `Next billing date: ${formatDate(periodEnd)}`
            }
          </p>
        )}

        <ul className={styles.featureList} role="list">
          {features.map((feature) => (
            <li key={feature} className={styles.featureItem}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={styles.checkIcon}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {feature}
            </li>
          ))}
        </ul>
      </section>

      {/* Usage */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Usage This Period</h2>
        <div className={styles.usageBar}>
          <div className={styles.usageInfo}>
            <span className={styles.usageLabel}>Podcasts Created</span>
            <span className={styles.usageCount}>
              {podcastsUsed} / {podcastsAllowed === -1 ? 'Unlimited' : podcastsAllowed}
            </span>
          </div>
          {podcastsAllowed > 0 && (
            <div className={styles.progressOuter}>
              <div
                className={styles.progressInner}
                style={{ width: `${Math.min((podcastsUsed / podcastsAllowed) * 100, 100)}%` }}
                role="progressbar"
                aria-valuenow={podcastsUsed}
                aria-valuemin={0}
                aria-valuemax={podcastsAllowed}
                aria-label={`${podcastsUsed} of ${podcastsAllowed} podcasts used`}
              />
            </div>
          )}
        </div>
      </section>

      {/* Actions */}
      <BillingActions tier={tier} />

      {/* Billing History */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Billing History</h2>
        <p className={styles.placeholder}>
          Your invoices and payment history will appear here once available.
        </p>
      </section>
    </main>
  );
}
