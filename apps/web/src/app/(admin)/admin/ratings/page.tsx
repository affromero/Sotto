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

interface AiStats {
  aiProvider: string;
  aiModel: string;
  ratingCount: number;
  avgContentAccuracy: number;
  avgConversationFlow: number;
  avgOverallSatisfaction: number;
}

interface SttStats {
  sttProvider: string;
  sttModel: string;
  ratingCount: number;
  avgOverallSatisfaction: number;
}

interface TopicProviderStats {
  tagName: string;
  provider: string;
  ratingCount: number;
  avgScore: number;
}

interface SourceBreakdown {
  isCreator: boolean;
  ratingCount: number;
  avgOverallSatisfaction: number;
}

async function getRatingStats(since: Date) {

  const [
    byProvider,
    byAi,
    byStt,
    byTopicTts,
    byTopicAi,
    sourceBreakdown,
    overallAverages,
    recentRatings,
    totalCount,
  ] = await Promise.all([
    // TTS provider breakdown
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

    // AI provider + model breakdown (all 4 dimensions)
    prisma.$queryRaw<AiStats[]>`
      SELECT
        p."aiProvider",
        p."aiModel",
        COUNT(*)::int AS "ratingCount",
        AVG(r."contentAccuracy")::float AS "avgContentAccuracy",
        AVG(r."conversationFlow")::float AS "avgConversationFlow",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."aiProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."aiProvider", p."aiModel"
      ORDER BY "ratingCount" DESC
    `,

    // STT provider + model breakdown
    prisma.$queryRaw<SttStats[]>`
      SELECT
        p."sttProvider",
        p."sttModel",
        COUNT(*)::int AS "ratingCount",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      WHERE p."sttProvider" IS NOT NULL AND p."deletedAt" IS NULL AND r."createdAt" >= ${since}
      GROUP BY p."sttProvider", p."sttModel"
      ORDER BY "ratingCount" DESC
    `,

    // Topic × TTS: voice naturalness per topic+provider (parent tags only)
    prisma.$queryRaw<TopicProviderStats[]>`
      SELECT
        t.name AS "tagName",
        p."ttsProvider" AS "provider",
        COUNT(*)::int AS "ratingCount",
        AVG(r."voiceNaturalness")::float AS "avgScore"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      JOIN "PodcastTag" pt ON p.id = pt."podcastId"
      JOIN "Tag" t ON pt."tagId" = t.id
      WHERE p."ttsProvider" IS NOT NULL
        AND t."parentId" IS NULL
        AND p."deletedAt" IS NULL
        AND r."createdAt" >= ${since}
      GROUP BY t.name, p."ttsProvider"
      HAVING COUNT(*) >= 2
      ORDER BY t.name, "avgScore" DESC
    `,

    // Topic × AI: content accuracy per topic+provider (parent tags only)
    prisma.$queryRaw<TopicProviderStats[]>`
      SELECT
        t.name AS "tagName",
        p."aiProvider" AS "provider",
        COUNT(*)::int AS "ratingCount",
        AVG(r."contentAccuracy")::float AS "avgScore"
      FROM "PodcastRating" r
      JOIN "Podcast" p ON r."podcastId" = p.id
      JOIN "PodcastTag" pt ON p.id = pt."podcastId"
      JOIN "Tag" t ON pt."tagId" = t.id
      WHERE p."aiProvider" IS NOT NULL
        AND t."parentId" IS NULL
        AND p."deletedAt" IS NULL
        AND r."createdAt" >= ${since}
      GROUP BY t.name, p."aiProvider"
      HAVING COUNT(*) >= 2
      ORDER BY t.name, "avgScore" DESC
    `,

    // Creator vs listener breakdown
    prisma.$queryRaw<SourceBreakdown[]>`
      SELECT
        r."isCreator",
        COUNT(*)::int AS "ratingCount",
        AVG(r."overallSatisfaction")::float AS "avgOverallSatisfaction"
      FROM "PodcastRating" r
      WHERE r."createdAt" >= ${since}
      GROUP BY r."isCreator"
    `,

    // Overall averages
    prisma.podcastRating.aggregate({
      where: { createdAt: { gte: since } },
      _avg: {
        voiceNaturalness: true,
        contentAccuracy: true,
        conversationFlow: true,
        overallSatisfaction: true,
      },
    }),

    // Recent ratings (with isCreator + provider info)
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
        isCreator: true,
        createdAt: true,
        podcast: {
          select: {
            id: true,
            title: true,
            ttsProvider: true,
            aiProvider: true,
            sttProvider: true,
          },
        },
      },
    }),

    // Total count
    prisma.podcastRating.count({
      where: { createdAt: { gte: since } },
    }),
  ]);

  const creatorCount = sourceBreakdown.find((s) => s.isCreator === true)?.ratingCount ?? 0;
  const listenerCount = sourceBreakdown.find((s) => s.isCreator === false)?.ratingCount ?? 0;

  return {
    byProvider,
    byAi,
    byStt,
    byTopicTts,
    byTopicAi,
    creatorCount,
    listenerCount,
    overallAverages: overallAverages._avg,
    recentRatings,
    totalCount,
  };
}

function scoreColor(score: number): string {
  if (score >= 4) return 'scoreGreen';
  if (score >= 3) return 'scoreAmber';
  return 'scoreRed';
}

export default async function AdminRatingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeParam = params.range ?? '30';
  const since = (() => {
    const today = startOfDay(new Date());
    if (rangeParam === 'today') return today;
    if (rangeParam === 'yesterday') return subDays(today, 1);
    if (rangeParam === 'all') return new Date(0);
    const days = [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
    return subDays(today, days);
  })();

  const stats = await getRatingStats(since);
  const avg = stats.overallAverages;

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Quality Ratings</h1>
          <p className={styles.subtitle}>
            Quality ratings by provider ({stats.totalCount} total — {stats.creatorCount} creator, {stats.listenerCount} listener)
          </p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
            { value: 'all', label: 'All' },
          ].map(({ value, label }) => (
            <a
              key={value}
              href={`/admin/ratings?range=${value}`}
              className={`${styles.rangeLink} ${rangeParam === value ? styles.rangeLinkActive : ''}`}
              aria-current={rangeParam === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* Summary Cards */}
      <div className={styles.summaryGrid}>
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
        <div className={styles.card}>
          <span className={styles.cardLabel}>Creator Ratings</span>
          <span className={styles.cardValue}>{stats.creatorCount}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Listener Ratings</span>
          <span className={styles.cardValue}>{stats.listenerCount}</span>
        </div>
      </div>

      {/* TTS Provider Comparison */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>TTS Provider Comparison</h2>
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

      {/* AI Provider Comparison */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>AI Provider Comparison</h2>
        {stats.byAi.length === 0 ? (
          <p className={styles.empty}>No ratings with AI provider data yet.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th className={styles.numberCol}>Count</th>
                  <th className={styles.numberCol}>Accuracy</th>
                  <th className={styles.numberCol}>Flow</th>
                  <th className={styles.numberCol}>Overall</th>
                </tr>
              </thead>
              <tbody>
                {stats.byAi.map((a) => (
                  <tr key={`${a.aiProvider}-${a.aiModel}`}>
                    <td className={styles.providerCell}>{a.aiProvider}</td>
                    <td className={styles.modelCell}>{a.aiModel ?? '—'}</td>
                    <td className={styles.numberCol}>{a.ratingCount}</td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(a.avgContentAccuracy)]}`}>
                      {a.avgContentAccuracy.toFixed(1)}
                    </td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(a.avgConversationFlow)]}`}>
                      {a.avgConversationFlow.toFixed(1)}
                    </td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(a.avgOverallSatisfaction)]}`}>
                      {a.avgOverallSatisfaction.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* STT Provider Stats */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>STT Provider Stats</h2>
        {stats.byStt.length === 0 ? (
          <p className={styles.empty}>No ratings with STT provider data yet.</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th className={styles.numberCol}>Count</th>
                  <th className={styles.numberCol}>Overall</th>
                </tr>
              </thead>
              <tbody>
                {stats.byStt.map((s) => (
                  <tr key={`${s.sttProvider}-${s.sttModel}`}>
                    <td className={styles.providerCell}>{s.sttProvider}</td>
                    <td className={styles.modelCell}>{s.sttModel ?? '—'}</td>
                    <td className={styles.numberCol}>{s.ratingCount}</td>
                    <td className={`${styles.numberCol} ${styles[scoreColor(s.avgOverallSatisfaction)]}`}>
                      {s.avgOverallSatisfaction.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Topic × Model Performance */}
      {(stats.byTopicTts.length > 0 || stats.byTopicAi.length > 0) && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Topic Performance</h2>
          <div className={styles.columns}>
            {stats.byTopicTts.length > 0 && (
              <div>
                <h3 className={styles.subSectionTitle}>TTS Voice Quality by Topic</h3>
                <div className={styles.tableContainer}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Topic</th>
                        <th>Provider</th>
                        <th className={styles.numberCol}>Count</th>
                        <th className={styles.numberCol}>Voice Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byTopicTts.map((t) => (
                        <tr key={`${t.tagName}-${t.provider}`}>
                          <td>{t.tagName}</td>
                          <td className={styles.providerCell}>{t.provider}</td>
                          <td className={styles.numberCol}>{t.ratingCount}</td>
                          <td className={`${styles.numberCol} ${styles[scoreColor(t.avgScore)]}`}>
                            {t.avgScore.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {stats.byTopicAi.length > 0 && (
              <div>
                <h3 className={styles.subSectionTitle}>AI Accuracy by Topic</h3>
                <div className={styles.tableContainer}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Topic</th>
                        <th>Provider</th>
                        <th className={styles.numberCol}>Count</th>
                        <th className={styles.numberCol}>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byTopicAi.map((t) => (
                        <tr key={`${t.tagName}-${t.provider}`}>
                          <td>{t.tagName}</td>
                          <td className={styles.providerCell}>{t.provider}</td>
                          <td className={styles.numberCol}>{t.ratingCount}</td>
                          <td className={`${styles.numberCol} ${styles[scoreColor(t.avgScore)]}`}>
                            {t.avgScore.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

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
                  <th>Source</th>
                  <th>TTS</th>
                  <th>AI</th>
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
                    <td>
                      <span className={`${styles.badge} ${r.isCreator ? styles.badgeCreator : styles.badgeListener}`}>
                        {r.isCreator ? 'Creator' : 'Listener'}
                      </span>
                    </td>
                    <td className={styles.providerCell}>{r.podcast.ttsProvider ?? '—'}</td>
                    <td className={styles.providerCell}>{r.podcast.aiProvider ?? '—'}</td>
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
