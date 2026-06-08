import {
  getRevenueOverview,
  getDailyRevenueTrend,
  getTopSellingVoices,
  getRevenueByStatus,
  getMarketplaceHealth,
} from '@/lib/revenue-metrics';
import { subDays, startOfDay } from 'date-fns';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const statusStyles: Record<string, string> = {
  captured: styles.statusCaptured,
  authorized: styles.statusAuthorized,
  cancelled: styles.statusCancelled,
  refunded: styles.statusRefunded,
};

export default async function AdminRevenuePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const { since, days } = (() => {
    const today = startOfDay(new Date());
    if (rangeParam === 'today') return { since: today, days: 1 };
    if (rangeParam === 'yesterday') return { since: subDays(today, 1), days: 1 };
    const d = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
    return { since: subDays(today, d), days: d };
  })();

  const [overview, dailyTrend, topVoices, statusBreakdown, marketplace] = await Promise.all([
    getRevenueOverview(since),
    getDailyRevenueTrend(days),
    getTopSellingVoices(10),
    getRevenueByStatus(),
    getMarketplaceHealth(),
  ]);

  const maxDailyRevenue = Math.max(...dailyTrend.map((d) => d.revenueCents), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Revenue Dashboard</h1>
          <p className={styles.subtitle}>Paid voice-sharing revenue, purchases, and seller metrics</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ].map(({ value, label }) => (
            <a
              key={value}
              href={`/admin/revenue?range=${value}`}
              className={`${styles.rangeLink} ${rangeParam === value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* Top cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Total Revenue</span>
          <span className={styles.cardValue}>{formatCents(overview.totalRevenueCents)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Platform Fees</span>
          <span className={styles.cardValue}>{formatCents(overview.platformFeesCents)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Net to Creators</span>
          <span className={styles.cardValue}>{formatCents(overview.netToCreatorsCents)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Total Purchases</span>
          <span className={styles.cardValue}>{overview.totalPurchases.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Avg Price</span>
          <span className={styles.cardValue}>{formatCents(overview.avgPriceCents)}</span>
        </div>
      </div>

      <div className={styles.columns}>
        {/* Daily revenue chart */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Daily Revenue</h2>
          {dailyTrend.length === 0 ? (
            <p className={styles.empty}>No revenue data yet.</p>
          ) : (
            <div className={styles.chartContainer} role="img" aria-label="Daily revenue bar chart">
              {dailyTrend.map((d) => (
                <div key={d.date} className={styles.chartBar}>
                  <div
                    className={styles.chartBarFill}
                    style={{ height: `${(d.revenueCents / maxDailyRevenue) * 100}%` }}
                    title={`${d.date}: ${formatCents(d.revenueCents)} (${d.count} purchases)`}
                  />
                  <span className={styles.chartLabel}>
                    {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Revenue by status */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Revenue by Status</h2>
          {statusBreakdown.length === 0 ? (
            <p className={styles.empty}>No purchase data yet.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {statusBreakdown.map((s) => (
                  <tr key={s.status}>
                    <td>
                      <span className={`${styles.statusBadge} ${statusStyles[s.status] ?? ''}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>{s.count.toLocaleString()}</td>
                    <td>{formatCents(s.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Top selling voices */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Top Selling Voices</h2>
        {topVoices.length === 0 ? (
          <p className={styles.empty}>No voice sales yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Voice</th>
                <th>Owner</th>
                <th>Revenue</th>
                <th>Purchases</th>
              </tr>
            </thead>
            <tbody>
              {topVoices.map((v) => (
                <tr key={v.voiceCloneId}>
                  <td>{v.voiceName}</td>
                  <td>{v.ownerName ?? '—'}</td>
                  <td>{formatCents(v.totalRevenueCents)}</td>
                  <td>{v.purchaseCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Paid voice-sharing health */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Paid Voice Sharing Health</h2>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Stripe-Connected Sellers</span>
            <span className={styles.statValue}>{marketplace.connectedSellers}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Paid Voices</span>
            <span className={styles.statValue}>{marketplace.paidVoices}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Free Voices</span>
            <span className={styles.statValue}>{marketplace.freeVoices}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
