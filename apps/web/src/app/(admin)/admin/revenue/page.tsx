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
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  const since = subDays(startOfDay(new Date()), days);

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
          <p className={styles.subtitle}>Voice marketplace revenue, purchases, and seller metrics</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/revenue?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d}d
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

      {/* Marketplace health */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Marketplace Health</h2>
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
