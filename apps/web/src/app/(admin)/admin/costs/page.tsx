import { getCostBreakdown, getDailyCostTrend, checkCostThresholds } from '@/lib/cost-monitor';
import { prisma } from '@/lib/prisma';
import { subDays, startOfDay } from 'date-fns';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function periodFromDays(days: number): '24h' | '7d' | '30d' | '90d' {
  if (days <= 1) return '24h';
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  return '90d';
}

async function getCostPerPodcast(since: Date): Promise<number> {
  const [totalCost, podcastCount] = await Promise.all([
    prisma.apiUsageLog.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { totalCost: true },
    }),
    prisma.podcast.count({
      where: { createdAt: { gte: since }, status: 'READY' },
    }),
  ]);
  const cost = totalCost._sum.totalCost ?? 0;
  return podcastCount > 0 ? cost / podcastCount : 0;
}

export default async function AdminCostsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const days = [1, 7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
  const since = subDays(startOfDay(new Date()), days);
  const period = periodFromDays(days);

  const [breakdown, dailyTrend, warnings, costPerPodcast] = await Promise.all([
    getCostBreakdown(period),
    getDailyCostTrend(days),
    checkCostThresholds(),
    getCostPerPodcast(since),
  ]);

  const AI_SERVICES = new Set(['anthropic', 'openai']);
  const SYSTEM_SERVICES = new Set(['ffmpeg']);

  const aiCost = breakdown.providers
    .filter((p) => AI_SERVICES.has(p.service))
    .reduce((sum, p) => sum + p.totalCost, 0);
  const ttsCost = breakdown.providers
    .filter((p) => !AI_SERVICES.has(p.service) && !SYSTEM_SERVICES.has(p.service))
    .reduce((sum, p) => sum + p.totalCost, 0);

  const maxDailyCost = Math.max(...dailyTrend.map((d) => d.totalCost), 0.01);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Cost Dashboard</h1>
          <p className={styles.subtitle}>API costs by provider, daily trends, and threshold alerts</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[1, 7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/admin/costs?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d === 1 ? 'today' : `${d}d`}
            </a>
          ))}
        </nav>
      </div>

      {/* Top cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Total Cost</span>
          <span className={styles.cardValue}>${breakdown.totalCost.toFixed(2)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>AI Cost</span>
          <span className={styles.cardValue}>${aiCost.toFixed(2)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>TTS Cost</span>
          <span className={styles.cardValue}>${ttsCost.toFixed(2)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Cost / Podcast</span>
          <span className={styles.cardValue}>${costPerPodcast.toFixed(2)}</span>
        </div>
      </div>

      {/* Daily cost trend chart */}
      <section className={styles.section}>
        <div className={styles.chartHeader}>
          <h2 className={styles.sectionTitle}>Daily Cost Trend</h2>
          <div className={styles.chartLegend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDotAi} />
              AI
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendDotTts} />
              TTS
            </span>
          </div>
        </div>
        {dailyTrend.length === 0 ? (
          <p className={styles.empty}>No cost data yet.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Daily cost trend bar chart">
            {dailyTrend.map((d) => {
              const aiDayCost = Object.entries(d.services)
                .filter(([svc]) => AI_SERVICES.has(svc))
                .reduce((sum, [, cost]) => sum + cost, 0);
              const ttsDayCost = d.totalCost - aiDayCost;
              const aiPct = (aiDayCost / maxDailyCost) * 100;
              const ttsPct = (ttsDayCost / maxDailyCost) * 100;

              return (
                <div key={d.date} className={styles.chartBar}>
                  <span className={styles.chartTooltip}>
                    ${d.totalCost.toFixed(2)}
                    <span className={styles.chartTooltipDetail}>AI: ${aiDayCost.toFixed(2)} &middot; TTS: ${ttsDayCost.toFixed(2)}</span>
                  </span>
                  {ttsDayCost > 0 && (
                    <div
                      className={styles.chartBarFillAccent}
                      style={{ height: `${ttsPct}%` }}
                    />
                  )}
                  {aiDayCost > 0 && (
                    <div
                      className={styles.chartBarFill}
                      style={{ height: `${aiPct}%` }}
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

      {/* Provider breakdown table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Provider Breakdown</h2>
        {breakdown.providers.length === 0 ? (
          <p className={styles.empty}>No provider data yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Service</th>
                <th>Model</th>
                <th>Category</th>
                <th>Cost</th>
                <th>Calls</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.providers.flatMap((p) =>
                p.categories.length > 0
                  ? p.categories.map((cat, i) => (
                      <tr key={`${p.service}-${p.modelId ?? 'none'}-${cat.category}`}>
                        {i === 0 ? (
                          <>
                            <td rowSpan={p.categories.length} className={styles.cellGrouped}>{p.service}</td>
                            <td rowSpan={p.categories.length} className={styles.cellGrouped}>{p.modelId ?? '—'}</td>
                          </>
                        ) : null}
                        <td>{cat.category}</td>
                        <td>${cat.totalCost.toFixed(4)}</td>
                        <td>{cat.callCount.toLocaleString()}</td>
                      </tr>
                    ))
                  : [(
                      <tr key={`${p.service}-${p.modelId ?? 'none'}`}>
                        <td>{p.service}</td>
                        <td>{p.modelId ?? '—'}</td>
                        <td>—</td>
                        <td>${p.totalCost.toFixed(4)}</td>
                        <td>{p.callCount.toLocaleString()}</td>
                      </tr>
                    )]
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* Cost warnings */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cost Warnings</h2>
        {warnings.length === 0 ? (
          <p className={styles.noWarnings}>No cost threshold warnings.</p>
        ) : (
          warnings.map((w) => (
            <div key={w.service} className={styles.warningCard}>
              <strong>{w.service}</strong> exceeded daily threshold: ${w.dailyCost.toFixed(2)} / ${w.threshold.toFixed(2)}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
