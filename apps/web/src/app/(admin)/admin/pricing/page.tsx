import { getCurrentModelPricing, getModelPriceHistory, getLastFetchTime } from '@/lib/pricing-metrics';
import { getCheapestModel } from '@/lib/pricing';
import { formatDistanceToNow } from 'date-fns';
import styles from './page.module.css';

function formatTokenCount(tokens: number | null): string {
  if (tokens === null) return '—';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function sourceBadgeClass(source: string): string {
  if (source === 'fetched') return `${styles.sourceBadge} ${styles.sourceFetched}`;
  if (source === 'admin') return `${styles.sourceBadge} ${styles.sourceAdmin}`;
  return `${styles.sourceBadge} ${styles.sourceRegistry}`;
}

export default async function AdminPricingPage() {
  const [pricing, priceHistory, lastFetch] = await Promise.all([
    getCurrentModelPricing(),
    getModelPriceHistory(30),
    getLastFetchTime(),
  ]);

  const cheapestId = getCheapestModel();
  const cheapestModel = pricing.find((m) => m.modelId === cheapestId);

  const mostExpensive = pricing.reduce<typeof pricing[0] | null>((max, m) => {
    if (m.modelId.startsWith('text-embedding') || m.modelId.startsWith('claude-code:')) return max;
    const total = m.inputPerMTok + m.outputPerMTok;
    if (!max) return m;
    return total > max.inputPerMTok + max.outputPerMTok ? m : max;
  }, null);

  // Filter out embeddings and claude-code for the generative model count
  const generativeModels = pricing.filter(
    (m) => !m.modelId.startsWith('text-embedding') && !m.modelId.startsWith('claude-code:')
  );

  // Group models by provider for the table
  const providers = new Map<string, typeof pricing>();
  for (const m of generativeModels) {
    const group = providers.get(m.provider) ?? [];
    group.push(m);
    providers.set(m.provider, group);
  }

  // Price history chart — show input pricing per model over last 30 days
  const historyModels = Array.from(priceHistory.keys()).filter(
    (id) => !id.startsWith('text-embedding') && !id.startsWith('claude-code:')
  );
  const allDates = new Set<string>();
  for (const points of priceHistory.values()) {
    for (const p of points) allDates.add(p.date);
  }
  const sortedDates = Array.from(allDates).sort();
  const maxPrice = Math.max(
    ...historyModels.flatMap((id) =>
      (priceHistory.get(id) ?? []).map((p) => p.inputPerMTok)
    ),
    0.01
  );

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Model Pricing</h1>
          <p className={styles.subtitle}>Current AI model rates, source tracking, and price history</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Models Tracked</span>
          <span className={styles.cardValue}>{generativeModels.length}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Cheapest Model</span>
          <span className={styles.cardValue}>
            {cheapestModel ? cheapestModel.displayName : '—'}
          </span>
          {cheapestModel && (
            <span className={styles.cardSecondary}>
              ${(cheapestModel.inputPerMTok + cheapestModel.outputPerMTok).toFixed(2)}/MTok
            </span>
          )}
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Most Expensive</span>
          <span className={styles.cardValue}>
            {mostExpensive ? mostExpensive.displayName : '—'}
          </span>
          {mostExpensive && (
            <span className={styles.cardSecondary}>
              ${(mostExpensive.inputPerMTok + mostExpensive.outputPerMTok).toFixed(2)}/MTok
            </span>
          )}
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Last Fetched</span>
          <span className={styles.cardValue}>
            {lastFetch ? formatDistanceToNow(lastFetch, { addSuffix: true }) : 'Never'}
          </span>
        </div>
      </div>

      {/* Current pricing table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Current Rates</h2>
        {generativeModels.length === 0 ? (
          <p className={styles.empty}>No pricing data yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Model</th>
                <th className={styles.numCell}>Input $/MTok</th>
                <th className={styles.numCell}>Output $/MTok</th>
                <th className={styles.numCell}>Context</th>
                <th className={styles.numCell}>Max Output</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(providers.entries()).flatMap(([provider, models]) => [
                <tr key={`provider-${provider}`} className={styles.providerRow}>
                  <td colSpan={6}>{provider}</td>
                </tr>,
                ...models.map((m) => (
                  <tr key={m.modelId}>
                    <td>{m.displayName}</td>
                    <td className={styles.numCell}>${m.inputPerMTok.toFixed(2)}</td>
                    <td className={styles.numCell}>${m.outputPerMTok.toFixed(2)}</td>
                    <td className={styles.numCell}>{formatTokenCount(m.contextWindow)}</td>
                    <td className={styles.numCell}>{formatTokenCount(m.maxOutputTokens)}</td>
                    <td>
                      <span className={sourceBadgeClass(m.source)}>{m.source}</span>
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        )}
      </section>

      {/* Price history chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Input Price History (30 days)</h2>
        {sortedDates.length === 0 ? (
          <p className={styles.empty}>No price history yet. Pricing data will appear after the first fetch.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Input price history bar chart">
            {sortedDates.map((date) => {
              // Show the highest input price for that day across all models
              let maxDayPrice = 0;
              let modelCount = 0;
              for (const modelId of historyModels) {
                const point = (priceHistory.get(modelId) ?? []).find((p) => p.date === date);
                if (point) {
                  if (point.inputPerMTok > maxDayPrice) maxDayPrice = point.inputPerMTok;
                  modelCount++;
                }
              }
              const pct = (maxDayPrice / maxPrice) * 100;

              return (
                <div key={date} className={styles.chartBar}>
                  <span className={styles.chartTooltip}>
                    ${maxDayPrice.toFixed(2)}/MTok
                    <span className={styles.chartTooltipDetail}>
                      {modelCount} model{modelCount !== 1 ? 's' : ''} updated
                    </span>
                  </span>
                  <div className={styles.chartBarFill} style={{ height: `${pct}%` }} />
                  <span className={styles.chartLabel}>
                    {new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
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
    </div>
  );
}
