import { getStorageOverview, getStorageTrend, checkStorageAlerts } from '@/lib/storage-metrics';
import { isR2MonitoringConfigured } from '@/lib/cloudflare-r2-usage';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

export default async function AdminStoragePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;

  if (!isR2MonitoringConfigured()) {
    return (
      <div className={styles.container}>
        <div className={styles.headerRow}>
          <div className={styles.header}>
            <h1 className={styles.title}>Storage</h1>
            <p className={styles.subtitle}>R2 usage monitoring and cost estimates</p>
          </div>
        </div>
        <div className={styles.notConfigured}>
          <h2>R2 Monitoring Not Configured</h2>
          <p>
            To enable R2 usage monitoring, create a Cloudflare API token with
            <strong> Workers R2 Storage: Read</strong> and <strong>Account Analytics: Read</strong> permissions,
            then add <code>CF_API_TOKEN</code> to Doppler (both dev and prd configs).
          </p>
          <p>
            <code>R2_ACCOUNT_ID</code> must also be set (used for both storage and monitoring).
          </p>
        </div>
      </div>
    );
  }

  const [overview, trend, alerts] = await Promise.all([
    getStorageOverview(),
    getStorageTrend(days),
    getStorageOverview().then((o) => checkStorageAlerts(o)),
  ]);

  const totalSizeBytes = overview
    ? overview.payloadSizeBytes + overview.metadataSizeBytes
    : 0;
  const totalSizeGb = totalSizeBytes / (1024 ** 3);
  const costPerGb = totalSizeGb > 0 && overview
    ? overview.totalCostEstimate / totalSizeGb
    : 0;

  const maxStorageGb = Math.max(...trend.map((d) => d.payloadSizeGb), 0.001);
  const maxCost = Math.max(...trend.map((d) => d.totalCost), 0.001);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Storage</h1>
          <p className={styles.subtitle}>R2 usage monitoring and cost estimates</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ].map(({ value, label }) => (
            <a
              key={value}
              href={`/admin/storage?range=${value}`}
              className={`${styles.rangeLink} ${rangeParam === value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <section className={styles.section}>
          {alerts.map((alert, i) => (
            <div
              key={i}
              className={alert.level === 'alert' ? styles.alertDanger : styles.alertWarn}
            >
              {alert.message}
            </div>
          ))}
        </section>
      )}

      {/* Top stat cards */}
      {overview ? (
        <div className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Total Size</span>
            <span className={styles.cardValue}>{formatBytes(totalSizeBytes)}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Object Count</span>
            <span className={styles.cardValue}>{overview.objectCount.toLocaleString()}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Monthly Cost</span>
            <span className={styles.cardValue}>${overview.totalCostEstimate.toFixed(2)}</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>Cost / GB</span>
            <span className={styles.cardValue}>${costPerGb.toFixed(3)}</span>
          </div>
        </div>
      ) : (
        <p className={styles.empty}>No snapshots collected yet. The worker runs daily.</p>
      )}

      {/* Storage trend chart */}
      <section className={styles.section}>
        <div className={styles.chartHeader}>
          <h2 className={styles.sectionTitle}>Storage Trend</h2>
          <div className={styles.chartLegend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDotStorage} />
              Storage
            </span>
          </div>
        </div>
        {trend.length === 0 ? (
          <p className={styles.empty}>No trend data yet.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Storage trend bar chart">
            {trend.map((d) => {
              const pct = (d.payloadSizeGb / maxStorageGb) * 100;
              return (
                <div key={d.date} className={styles.chartBar}>
                  <span className={styles.chartTooltip}>
                    {d.payloadSizeGb.toFixed(2)} GB
                    <span className={styles.chartTooltipDetail}>
                      {d.objectCount.toLocaleString()} objects
                    </span>
                  </span>
                  <div
                    className={styles.chartBarFill}
                    style={{ height: `${pct}%` }}
                  />
                  <span className={styles.chartLabel}>
                    {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Cost trend chart */}
      <section className={styles.section}>
        <div className={styles.chartHeader}>
          <h2 className={styles.sectionTitle}>Cost Trend</h2>
          <div className={styles.chartLegend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDotStorage} />
              Storage
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendDotOps} />
              Operations
            </span>
          </div>
        </div>
        {trend.length === 0 ? (
          <p className={styles.empty}>No cost data yet.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Cost trend bar chart">
            {trend.map((d) => {
              const storagePct = (d.storageCost / maxCost) * 100;
              const opsPct = (d.opsCost / maxCost) * 100;
              return (
                <div key={d.date} className={styles.chartBar}>
                  <span className={styles.chartTooltip}>
                    ${d.totalCost.toFixed(4)}
                    <span className={styles.chartTooltipDetail}>
                      Storage: ${d.storageCost.toFixed(4)} &middot; Ops: ${d.opsCost.toFixed(4)}
                    </span>
                  </span>
                  {d.opsCost > 0 && (
                    <div
                      className={styles.chartBarFillAccent}
                      style={{ height: `${opsPct}%` }}
                    />
                  )}
                  {d.storageCost > 0 && (
                    <div
                      className={styles.chartBarFill}
                      style={{ height: `${storagePct}%` }}
                    />
                  )}
                  <span className={styles.chartLabel}>
                    {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Operations breakdown */}
      {overview && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Operations Breakdown (Last 24h)</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Class</th>
                <th>Count</th>
                <th>Free Tier</th>
                <th>Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Class A (mutating)</td>
                <td>{overview.classAOps.toLocaleString()}</td>
                <td>1M free</td>
                <td>${overview.classACostEstimate.toFixed(4)}</td>
              </tr>
              <tr>
                <td>Class B (read)</td>
                <td>{overview.classBOps.toLocaleString()}</td>
                <td>10M free</td>
                <td>${overview.classBCostEstimate.toFixed(4)}</td>
              </tr>
              <tr>
                <td>Free (list/delete)</td>
                <td>{overview.freeOps.toLocaleString()}</td>
                <td>Always free</td>
                <td>$0.0000</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {/* No alerts message */}
      {alerts.length === 0 && overview && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Alerts</h2>
          <p className={styles.noAlerts}>No cost threshold alerts. Current estimate is within safe limits.</p>
        </section>
      )}
    </div>
  );
}
