import { subDays, startOfDay } from 'date-fns';
import {
  getOverallQualityScore,
  getQualityTrend,
  getModelUsageDistribution,
  getBestModelByTopic,
  getRatingVolumeTrend,
  getAutoResolutionStats,
} from '@/lib/quality-metrics';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

function scoreColor(score: number): string {
  if (score >= 4) return styles.scoreGreen;
  if (score >= 3) return styles.scoreAmber;
  return styles.scoreRed;
}

export default async function QualityAnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const since = (() => {
    const today = startOfDay(new Date());
    if (rangeParam === 'all') return new Date(0);
    const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
    return subDays(today, days);
  })();

  const [hero, trend, modelUsage, bestByTopic, volume, autoRes] = await Promise.all([
    getOverallQualityScore(since),
    getQualityTrend(since),
    getModelUsageDistribution(since),
    getBestModelByTopic(since),
    getRatingVolumeTrend(since),
    getAutoResolutionStats(since),
  ]);

  const ttsModels = modelUsage.filter((m) => m.providerType === 'tts');
  const aiModels = modelUsage.filter((m) => m.providerType === 'ai');
  const maxTtsCount = Math.max(...ttsModels.map((m) => m.podcastCount), 1);
  const maxAiCount = Math.max(...aiModels.map((m) => m.podcastCount), 1);
  const autoResAi = autoRes.rows.filter((r) => r.providerType === 'ai');
  const autoResTts = autoRes.rows.filter((r) => r.providerType === 'tts');
  const maxTrendOverall = Math.max(...trend.map((t) => t.avgOverall), 5);
  const maxVolume = Math.max(...volume.map((v) => v.creatorCount + v.listenerCount), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Quality Analytics</h1>
          <p className={styles.subtitle}>
            Investor-facing quality metrics across providers and topics
          </p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
            { value: 'all', label: 'All' },
          ].map(({ value, label }) => (
            <a
              key={value}
              href={`/admin/quality?range=${value}`}
              className={`${styles.rangeLink} ${rangeParam === value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* Hero Stats */}
      <div className={styles.heroGrid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Overall Quality</span>
          <span className={`${styles.cardValue} ${scoreColor(hero.avgSatisfaction)}`}>
            {hero.avgSatisfaction.toFixed(1)}<span className={styles.cardUnit}>/5</span>
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Total Ratings</span>
          <span className={styles.cardValue}>
            {hero.totalRatings}
          </span>
          <span className={styles.cardDetail}>
            {hero.creatorRatings} creator / {hero.listenerRatings} listener
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Rating Growth</span>
          <span className={`${styles.cardValue} ${hero.ratingGrowthPercent >= 0 ? styles.scoreGreen : styles.scoreRed}`}>
            {hero.ratingGrowthPercent >= 0 ? '+' : ''}{hero.ratingGrowthPercent}%
          </span>
          <span className={styles.cardDetail}>2nd half vs 1st half of period</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Top Rated Model</span>
          <span className={styles.cardValueSm}>{hero.topRatedModel ?? '—'}</span>
        </div>
      </div>

      {/* Quality Trend */}
      {trend.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Quality Trend (Weekly Avg Overall)</h2>
          <div className={styles.chartContainer} role="img" aria-label="Weekly quality trend bar chart">
            {trend.map((t) => {
              const pct = (t.avgOverall / maxTrendOverall) * 100;
              return (
                <div key={t.week} className={styles.chartBar}>
                  <span className={styles.chartTooltip}>
                    {t.avgOverall.toFixed(1)} avg
                    <span className={styles.chartTooltipDetail}>
                      {t.ratingCount} ratings
                    </span>
                  </span>
                  <div
                    className={`${styles.chartBarFill} ${t.avgOverall >= 4 ? styles.barGreen : t.avgOverall >= 3 ? styles.barAmber : styles.barRed}`}
                    style={{ height: `${pct}%` }}
                  />
                  <span className={styles.chartLabel}>{t.week.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Model Usage Distribution */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Model Usage Distribution</h2>
        <div className={styles.columns}>
          {ttsModels.length > 0 && (
            <div>
              <h3 className={styles.subSectionTitle}>TTS Providers</h3>
              <div className={styles.hBarContainer}>
                {ttsModels.map((m) => (
                  <div key={`${m.provider}-${m.model}`} className={styles.hBarRow}>
                    <span className={styles.hBarLabel}>{m.provider}</span>
                    <div className={styles.hBarTrack}>
                      <div
                        className={styles.hBarFill}
                        style={{ width: `${(m.podcastCount / maxTtsCount) * 100}%` }}
                      />
                    </div>
                    <span className={styles.hBarValue}>
                      {m.podcastCount} ({m.avgSatisfaction})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {aiModels.length > 0 && (
            <div>
              <h3 className={styles.subSectionTitle}>AI Providers</h3>
              <div className={styles.hBarContainer}>
                {aiModels.map((m) => (
                  <div key={`${m.provider}-${m.model}`} className={styles.hBarRow}>
                    <span className={styles.hBarLabel}>{m.provider}</span>
                    <div className={styles.hBarTrack}>
                      <div
                        className={styles.hBarFillAccent}
                        style={{ width: `${(m.podcastCount / maxAiCount) * 100}%` }}
                      />
                    </div>
                    <span className={styles.hBarValue}>
                      {m.podcastCount} ({m.avgSatisfaction})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Auto-Resolution */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Auto-Resolution</h2>
        <div className={styles.heroGrid} style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className={styles.card}>
            <span className={styles.cardLabel}>AI Auto</span>
            <span className={styles.cardValue}>{autoRes.aiAutoPercent}%</span>
          </div>
          <div className={styles.card}>
            <span className={styles.cardLabel}>TTS Auto</span>
            <span className={styles.cardValue}>{autoRes.ttsAutoPercent}%</span>
          </div>
        </div>
        <div className={styles.columns}>
          {autoResAi.length > 0 && (
            <div>
              <h3 className={styles.subSectionTitle}>AI Auto-Resolution</h3>
              <div className={styles.hBarContainer}>
                {autoResAi.map((r) => {
                  const total = r.autoCount + r.explicitCount;
                  const maxCount = Math.max(...autoResAi.map((x) => x.autoCount + x.explicitCount), 1);
                  return (
                    <div key={`${r.resolvedProvider}-${r.resolvedModel}`} className={styles.hBarRow}>
                      <span className={styles.hBarLabel}>
                        {r.resolvedProvider}{r.resolvedModel ? ` / ${r.resolvedModel}` : ''}
                      </span>
                      <div className={styles.hBarTrack}>
                        <div
                          className={styles.hBarFillAccent}
                          style={{ width: `${(total / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className={styles.hBarValue}>
                        {r.autoCount} auto / {r.explicitCount} explicit
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {autoResTts.length > 0 && (
            <div>
              <h3 className={styles.subSectionTitle}>TTS Auto-Resolution</h3>
              <div className={styles.hBarContainer}>
                {autoResTts.map((r) => {
                  const total = r.autoCount + r.explicitCount;
                  const maxCount = Math.max(...autoResTts.map((x) => x.autoCount + x.explicitCount), 1);
                  return (
                    <div key={`${r.resolvedProvider}-${r.resolvedModel}`} className={styles.hBarRow}>
                      <span className={styles.hBarLabel}>
                        {r.resolvedProvider}{r.resolvedModel ? ` / ${r.resolvedModel}` : ''}
                      </span>
                      <div className={styles.hBarTrack}>
                        <div
                          className={styles.hBarFill}
                          style={{ width: `${(total / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className={styles.hBarValue}>
                        {r.autoCount} auto / {r.explicitCount} explicit
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Best Model by Topic */}
      {bestByTopic.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Best Model by Topic</h2>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Best TTS</th>
                  <th className={styles.numberCol}>Voice Score</th>
                  <th>Best AI</th>
                  <th className={styles.numberCol}>Accuracy</th>
                  <th className={styles.numberCol}>Ratings</th>
                </tr>
              </thead>
              <tbody>
                {bestByTopic.map((row) => (
                  <tr key={row.topic}>
                    <td className={styles.topicCell}>{row.topic}</td>
                    <td className={styles.providerCell}>{row.bestTtsProvider ?? '—'}</td>
                    <td className={`${styles.numberCol} ${row.bestTtsScore ? scoreColor(row.bestTtsScore) : ''}`}>
                      {row.bestTtsScore?.toFixed(1) ?? '—'}
                    </td>
                    <td className={styles.providerCell}>{row.bestAiProvider ?? '—'}</td>
                    <td className={`${styles.numberCol} ${row.bestAiScore ? scoreColor(row.bestAiScore) : ''}`}>
                      {row.bestAiScore?.toFixed(1) ?? '—'}
                    </td>
                    <td className={styles.numberCol}>{row.ratingCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Rating Volume */}
      {volume.length > 0 && (
        <section className={styles.section}>
          <div className={styles.chartHeader}>
            <h2 className={styles.sectionTitle}>Rating Volume</h2>
            <div className={styles.chartLegend}>
              <span className={styles.legendItem}>
                <span className={styles.legendDotCreator} />
                Creator
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendDotListener} />
                Listener
              </span>
            </div>
          </div>
          <div className={styles.chartContainer} role="img" aria-label="Weekly rating volume stacked bar chart">
            {volume.map((v) => {
              const total = v.creatorCount + v.listenerCount;
              const creatorPct = (v.creatorCount / maxVolume) * 100;
              const listenerPct = (v.listenerCount / maxVolume) * 100;
              return (
                <div key={v.week} className={styles.chartBar}>
                  <span className={styles.chartTooltip}>
                    {total} total
                    <span className={styles.chartTooltipDetail}>
                      {v.creatorCount} creator + {v.listenerCount} listener
                    </span>
                  </span>
                  {v.listenerCount > 0 && (
                    <div className={styles.chartBarFillAccent} style={{ height: `${listenerPct}%` }} />
                  )}
                  {v.creatorCount > 0 && (
                    <div className={styles.chartBarFill} style={{ height: `${creatorPct}%` }} />
                  )}
                  <span className={styles.chartLabel}>{v.week.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
