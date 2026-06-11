import { getCostBreakdown, getDailyCostTrend, checkCostThresholds, getPerModelCostBreakdown } from '@/lib/cost-monitor';
import { getTopUsersByCost } from '@/lib/podcast-cost-stats';
import { prisma } from '@/lib/prisma';
import { getAiProviderIdsWithPricing, getAiModelDisplayName } from '@/lib/providers/ai-registry';
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
  const { since, days } = (() => {
    const today = startOfDay(new Date());
    if (rangeParam === 'today') return { since: today, days: 1 };
    if (rangeParam === 'yesterday') return { since: subDays(today, 1), days: 1 };
    const d = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
    return { since: subDays(today, d), days: d };
  })();
  const period = periodFromDays(days);

  const [breakdown, dailyTrend, warnings, costPerPodcast, perModelCosts, topUsers] = await Promise.all([
    getCostBreakdown(period),
    getDailyCostTrend(days),
    checkCostThresholds(),
    getCostPerPodcast(since),
    getPerModelCostBreakdown(period),
    getTopUsersByCost(period, 25),
  ]);

  const AI_SERVICES: Set<string> = new Set(getAiProviderIdsWithPricing());
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
          <p className={styles.subtitle}>
            Your provider spend (AI, TTS, STT) by provider and model, daily trends, and threshold
            alerts. Visible to every admin on this server.
          </p>
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
              href={`/admin/costs?range=${value}`}
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
          <span className={styles.cardLabel}>Cost / generation</span>
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
              {breakdown.providers.flatMap((p) => {
                const hasMultipleCategories = p.categories.length > 1;
                const rowSpan = hasMultipleCategories ? p.categories.length + 1 : p.categories.length || 1;

                if (p.categories.length === 0) {
                  return [(
                    <tr key={`${p.service}-${p.modelId ?? 'none'}`}>
                      <td>{p.service}</td>
                      <td>{p.modelId ?? '—'}</td>
                      <td>—</td>
                      <td>${p.totalCost.toFixed(4)}</td>
                      <td>{p.callCount.toLocaleString()}</td>
                    </tr>
                  )];
                }

                const rows = p.categories.map((cat, i) => (
                  <tr key={`${p.service}-${p.modelId ?? 'none'}-${cat.category}`}>
                    {i === 0 ? (
                      <>
                        <td rowSpan={rowSpan} className={styles.cellGrouped}>{p.service}</td>
                        <td rowSpan={rowSpan} className={styles.cellGrouped}>{p.modelId ?? '—'}</td>
                      </>
                    ) : null}
                    <td>{cat.category}</td>
                    <td>${cat.totalCost.toFixed(4)}</td>
                    <td>{cat.callCount.toLocaleString()}</td>
                  </tr>
                ));

                if (hasMultipleCategories) {
                  rows.push(
                    <tr key={`${p.service}-${p.modelId ?? 'none'}-total`} className={styles.modelTotalRow}>
                      <td className={styles.modelTotalLabel}>Total</td>
                      <td className={styles.modelTotalValue}>${p.totalCost.toFixed(4)}</td>
                      <td className={styles.modelTotalValue}>{p.callCount.toLocaleString()}</td>
                    </tr>
                  );
                }

                return rows;
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Per-model cost breakdown */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Per-Model Costs</h2>
        {perModelCosts.length === 0 ? (
          <p className={styles.empty}>No per-model cost data yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th className={styles.numCell}>Input Tokens</th>
                <th className={styles.numCell}>Output Tokens</th>
                <th className={styles.numCell}>Total Cost</th>
                <th className={styles.numCell}>Calls</th>
                <th className={styles.numCell}>Avg $/Call</th>
              </tr>
            </thead>
            <tbody>
              {perModelCosts.map((m) => (
                <tr key={`${m.service}-${m.modelId}`}>
                  <td>{getAiModelDisplayName(m.modelId)}</td>
                  <td>{m.service}</td>
                  <td className={styles.numCell}>{m.inputTokens.toLocaleString()}</td>
                  <td className={styles.numCell}>{m.outputTokens.toLocaleString()}</td>
                  <td className={styles.numCell}>${m.totalCost.toFixed(2)}</td>
                  <td className={styles.numCell}>{m.callCount.toLocaleString()}</td>
                  <td className={styles.numCell}>${m.avgCostPerCall.toFixed(4)}</td>
                </tr>
              ))}
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

      {/* Top Users by Cost */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Top Users by Cost</h2>
        {topUsers.length === 0 ? (
          <p className={styles.empty}>No user cost data for this period.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th className={styles.numCell}>Period Cost</th>
                <th className={styles.numCell}>This Month</th>
                <th className={styles.numCell}>Generations</th>
              </tr>
            </thead>
            <tbody>
              {topUsers.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name || u.email || u.userId.slice(0, 8)}</td>
                  <td className={styles.numCell}>${u.totalCost.toFixed(2)}</td>
                  <td className={styles.numCell}>${u.monthCost.toFixed(2)}</td>
                  <td className={styles.numCell}>{u.podcastCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
