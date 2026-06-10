import { subDays, subMonths, startOfDay } from 'date-fns';
import {
  getPeakUsageHeatmap,
  getOptimalDurationByTopic,
  getGenerationToListenRatio,
  getSessionDepth,
  getAudienceArchetypes,
} from '@/lib/intelligence-metrics';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function AdminIntelligencePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const since = (() => {
    const today = startOfDay(new Date());
    if (rangeParam === 'today') return today;
    if (rangeParam === 'yesterday') return subDays(today, 1);
    const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
    return days === 90 ? subMonths(today, 3) : subDays(today, days);
  })();

  const [heatmap, durationTopics, genRatio, sessionDepth, archetypes] =
    await Promise.all([
      getPeakUsageHeatmap(since),
      getOptimalDurationByTopic(since),
      getGenerationToListenRatio(since),
      getSessionDepth(since),
      getAudienceArchetypes(since),
    ]);

  // Build heatmap grid: 7 days × 24 hours
  const heatmapMap = new Map<string, number>();
  let maxHeatVal = 1;
  for (const cell of heatmap) {
    const key = `${cell.dayOfWeek}-${cell.hour}`;
    heatmapMap.set(key, cell.listenMinutes);
    if (cell.listenMinutes > maxHeatVal) maxHeatVal = cell.listenMinutes;
  }

  // Best duration per topic (highest completion)
  const bestByTopic = new Map<string, typeof durationTopics[0]>();
  for (const row of durationTopics) {
    const existing = bestByTopic.get(row.topic);
    if (!existing || row.avgCompletion > existing.avgCompletion) {
      bestByTopic.set(row.topic, row);
    }
  }
  const topDurationRows = Array.from(bestByTopic.values())
    .sort((a, b) => b.avgCompletion - a.avgCompletion)
    .slice(0, 15);

  const maxArchetype = Math.max(...archetypes.map((a) => a.count), 1);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Platform Intelligence</h1>
          <p className={styles.subtitle}>Content analytics and audience insights</p>
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
              href={`/admin/intelligence?range=${value}`}
              className={`${styles.rangeLink} ${rangeParam === value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* Summary cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Gen-to-Listen Ratio</span>
          <span className={styles.cardValue}>
            {genRatio.totalListened}/{genRatio.totalGenerated}{' '}
            <span className={styles.cardSub}>({Math.round(genRatio.ratio * 100)}%)</span>
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Avg Session Duration</span>
          <span className={styles.cardValue}>{sessionDepth.avgDurationMinutes}m</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Podcasts/Session</span>
          <span className={styles.cardValue}>{sessionDepth.avgPodcastsPerSession}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Bounce Rate</span>
          <span className={styles.cardValue}>{Math.round(sessionDepth.bounceRate * 100)}%</span>
        </div>
      </div>

      {/* Peak Usage Heatmap */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Peak Usage Heatmap</h2>
        {heatmap.length === 0 ? (
          <p className={styles.empty}>No playback data yet.</p>
        ) : (
          <div className={styles.heatmapWrapper}>
            <div className={styles.heatmap} role="img" aria-label="Peak usage by day and hour">
              {/* Hour labels */}
              <div className={styles.heatmapCorner} />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={`h-${h}`} className={styles.heatmapHourLabel}>
                  {h}
                </div>
              ))}
              {/* Grid rows */}
              {DAY_NAMES.map((day, dow) => (
                <>
                  <div key={`day-${dow}`} className={styles.heatmapDayLabel}>
                    {day}
                  </div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const val = heatmapMap.get(`${dow}-${h}`) ?? 0;
                    const intensity = val / maxHeatVal;
                    return (
                      <div
                        key={`${dow}-${h}`}
                        className={styles.heatmapCell}
                        style={{
                          backgroundColor: `rgba(63, 79, 176, ${Math.max(intensity, 0.05)})`,
                        }}
                        title={`${day} ${h}:00 — ${val.toFixed(1)} min`}
                      />
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Optimal Duration by Topic */}
      {topDurationRows.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Optimal Duration by Topic</h2>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Best Duration</th>
                  <th>Avg Completion</th>
                  <th>Podcasts</th>
                </tr>
              </thead>
              <tbody>
                {topDurationRows.map((r) => (
                  <tr key={r.topic}>
                    <td>{r.topic}</td>
                    <td>{r.durationBucket}</td>
                    <td>{Math.round(r.avgCompletion)}%</td>
                    <td>{r.podcastCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Audience Archetypes */}
      {archetypes.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Audience Archetypes</h2>
          <div className={styles.hBarContainer}>
            {archetypes.map((a) => (
              <div key={a.archetype} className={styles.hBarRow}>
                <span className={styles.hBarLabel}>{a.archetype.replace(/_/g, ' ')}</span>
                <div className={styles.hBarTrack}>
                  <div
                    className={styles.hBarFill}
                    style={{ width: `${(a.count / maxArchetype) * 100}%` }}
                  />
                </div>
                <span className={styles.hBarValue}>{a.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
