import { prisma } from '@/lib/prisma';
import { subDays, startOfDay } from 'date-fns';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

interface ProviderStats {
  ttsProvider: string;
  ratingCount: number;
  avgVoiceNaturalness: number;
  avgContentAccuracy: number;
  avgConversationFlow: number;
  avgOverallSatisfaction: number;
}

async function getRatingStats(days: number | null) {
  const since = days ? subDays(startOfDay(new Date()), days) : new Date(0);

  const [byProvider, overallAverages, recentRatings, totalCount] = await Promise.all([
    prisma.$queryRaw<ProviderStats[]>`
      SELECT
        p."ttsProvider",
        COUNT(*)::int AS "ratingCount",
        AVG(r."voiceNaturalness")::float AS "avgVoiceNaturalness",
        AVG(r."contentAccuracy")::float AS "avgContentAccuracy",
        AVG(r."conversationFlow")::float AS "avgConversationFlow",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."ttsProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."ttsProvider"
      ORDER BY "ratingCount" DESC
    `,

    prisma.podcastRating.aggregate({
      where: { createdAt: { gte: since } },
      _avg: {
        voiceNaturalness: true,
        contentAccuracy: true,
        conversationFlow: true,
        overallSatisfaction: true,
      },
    }),

    prisma.podcastRating.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        voiceNaturalness: true,
        contentAccuracy: true,
        conversationFlow: true,
        overallSatisfaction: true,
        comment: true,
        createdAt: true,
        podcast: {
          select: {
            id: true,
            title: true,
            ttsProvider: true,
          },
        },
      },
    }),

    prisma.podcastRating.count({
      where: { createdAt: { gte: since } },
    }),
  ]);

  return { byProvider, overallAverages: overallAverages._avg, recentRatings, totalCount };
}

function scoreColor(score: number): string {
  if (score >= 4) return 'scoreGreen';
  if (score >= 3) return 'scoreAmber';
  return 'scoreRed';
}

export default async function AdminRatingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const daysMap: Record<string, number | null> = { '7': 7, '30': 30, '90': 90, all: null };
  const days = rangeParam in daysMap ? daysMap[rangeParam] : 30;

  const stats = await getRatingStats(days);
  const avg = stats.overallAverages;

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>TTS Ratings</h1>
          <p className={styles.subtitle}>
            Creator quality ratings by TTS provider ({stats.totalCount} total)
          </p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
            { value: 'all', label: 'All' },
          ].map((r) => (
            <a
              key={r.value}
              href={`/admin/ratings?range=${r.value}`}
              className={`${styles.rangeLink} ${rangeParam === r.value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === r.value ? 'page' : undefined}
            >
              {r.label}
            </a>
          ))}
        </nav>
      </div>

      {/* Summary Cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Voice</span>
          <span className={styles.cardValue}>{avg.voiceNaturalness?.toFixed(1) ?? '—'}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Accuracy</span>
          <span className={styles.cardValue}>{avg.contentAccuracy?.toFixed(1) ?? '—'}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Flow</span>
          <span className={styles.cardValue}>{avg.conversationFlow?.toFixed(1) ?? '—'}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Overall</span>
          <span className={styles.cardValue}>{avg.overallSatisfaction?.toFixed(1) ?? '—'}</span>
        </div>
      </div>

      {/* Provider Comparison Table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Provider Comparison</h2>
        {stats.byProvider.length === 0 ? (
          <p className={styles.empty}>No ratings with TTS provider data yet.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className={styles.numberCol}>Count</th>
                  <th className={styles.numberCol}>Voice</th>
                  <th className={styles.numberCol}>Accuracy</th>
                  <th className={styles.numberCol}>Flow</th>
                  <th className={styles.numberCol}>Overall</th>
                </tr>
              </thead>
              <tbody>
                {stats.byProvider.map((p) => (
                  <tr key={p.ttsProvider}>
                    <td className={styles.providerCell}>{p.ttsProvider}</td>
                    <td className={styles.numberCol}>{p.ratingCount}</td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(p.avgVoiceNaturalness)]}`}>
                      {p.avgVoiceNaturalness.toFixed(1)}
                    </td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(p.avgContentAccuracy)]}`}>
                      {p.avgContentAccuracy.toFixed(1)}
                    </td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(p.avgConversationFlow)]}`}>
                      {p.avgConversationFlow.toFixed(1)}
                    </td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(p.avgOverallSatisfaction)]}`}>
                      {p.avgOverallSatisfaction.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Ratings */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Ratings</h2>
        {stats.recentRatings.length === 0 ? (
          <p className={styles.empty}>No ratings yet.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Podcast</th>
                  <th>Provider</th>
                  <th className={styles.numberCol}>Voice</th>
                  <th className={styles.numberCol}>Accuracy</th>
                  <th className={styles.numberCol}>Flow</th>
                  <th className={styles.numberCol}>Overall</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRatings.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.titleCell}>{r.podcast.title}</td>
                    <td className={styles.providerCell}>{r.podcast.ttsProvider ?? '—'}</td>
                    <td className={styles.numberCol}>{r.voiceNaturalness}</td>
                    <td className={styles.numberCol}>{r.contentAccuracy}</td>
                    <td className={styles.numberCol}>{r.conversationFlow}</td>
                    <td className={styles.numberCol}>{r.overallSatisfaction}</td>
                    <td className={styles.commentCell}>{r.comment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
