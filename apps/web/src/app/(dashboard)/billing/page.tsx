import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TIER_LIMITS, type TierName } from '@/lib/stripe';
import { BillingActions } from './BillingActions';
import { CreditPackCard } from '@/components/billing/CreditPackCard';
import { Badge } from '@/components/ui/Badge';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Billing' };

const tierPrices: Record<string, number> = {
  FREE: 0,
  STARTER: 9,
  PRO: 24,
  STUDIO: 49,
};

const tierLabels: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PRO: 'Pro',
  STUDIO: 'Studio',
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTxDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default async function BillingPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [user, recentTransactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscription: {
          select: {
            tier: true,
            status: true,
            creditsBalance: true,
            creditsMonthly: true,
            rolloverCredits: true,
            maxRollover: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
          },
        },
      },
    }),
    prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amount: true,
        type: true,
        description: true,
        balanceAfter: true,
        createdAt: true,
      },
    }),
  ]);

  if (!user) return null;

  const sub = user.subscription;
  const tier = (sub?.tier || 'FREE') as TierName;
  const status = sub?.status || 'ACTIVE';
  const periodEnd = sub?.currentPeriodEnd;
  const cancelAtPeriodEnd = sub?.cancelAtPeriodEnd ?? false;
  const creditsBalance = sub?.creditsBalance ?? 0;
  const creditsMonthly = sub?.creditsMonthly ?? TIER_LIMITS[tier].creditsMonthly;
  const rolloverCredits = sub?.rolloverCredits ?? 0;
  const price = tierPrices[tier] ?? 0;

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>Billing</h1>

      {/* Credit Balance */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Credit Balance</h2>
        <div className={styles.creditCard}>
          <div className={styles.creditBalance}>{creditsBalance}</div>
          <div className={styles.creditMeta}>
            <span>{creditsMonthly} credits/month</span>
            {rolloverCredits > 0 && <span>{rolloverCredits} rolled over</span>}
            {periodEnd && <span>Renews {formatDate(periodEnd)}</span>}
          </div>
        </div>
        {creditsBalance === 0 && tier !== 'FREE' && (
          <p className={styles.outOfCredits}>
            You&apos;re out of credits. Buy a credit pack or wait for your next renewal.
          </p>
        )}
      </section>

      {/* Current Plan */}
      <section className={styles.section}>
        <div className={styles.planHeader}>
          <div className={styles.planInfo}>
            <h2 className={styles.sectionTitle}>Current Plan</h2>
            <div className={styles.planNameRow}>
              <span className={styles.planName}>{tierLabels[tier] || tier}</span>
              <Badge
                variant={
                  status === 'ACTIVE' ? 'success' : status === 'CANCELED' ? 'error' : 'warning'
                }
              >
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
              : `Next billing date: ${formatDate(periodEnd)}`}
          </p>
        )}
      </section>

      {/* Buy More Credits */}
      {tier !== 'FREE' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Buy More Credits</h2>
          <div className={styles.creditPackGrid}>
            <CreditPackCard credits={3} price={5} />
            <CreditPackCard credits={10} price={14} />
            <CreditPackCard credits={25} price={30} />
          </div>
        </section>
      )}

      {/* Credit History */}
      {recentTransactions.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Credit History</h2>
          <div className={styles.historyTable}>
            {recentTransactions.map((tx) => (
              <div key={tx.id} className={styles.historyRow}>
                <div className={styles.historyInfo}>
                  <span className={styles.historyDesc}>{tx.description}</span>
                  <span className={styles.historyDate}>{formatTxDate(tx.createdAt)}</span>
                </div>
                <div className={styles.historyAmount}>
                  <span className={tx.amount > 0 ? styles.amountPositive : styles.amountNegative}>
                    {tx.amount > 0 ? '+' : ''}
                    {tx.amount}
                  </span>
                  <span className={styles.historyBalance}>bal: {tx.balanceAfter}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Actions */}
      <BillingActions tier={tier} />
    </main>
  );
}
