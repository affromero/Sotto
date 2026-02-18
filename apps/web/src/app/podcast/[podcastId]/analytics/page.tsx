import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { subDays, startOfDay } from 'date-fns';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  getPodcastOverview,
  getPodcastDailyPlays,
  getPodcastRetentionCurve,
  getPodcastEngagement,
  getPodcastListenerBehavior,
  getPodcastTrafficSources,
} from '@/lib/podcast-analytics';
import styles from './page.module.css';

interface PageProps {
  params: Promise<{ podcastId: string }>;
  searchParams: Promise<{ range?: string }>;
}

export const metadata = { title: 'Podcast Analytics' };

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

export default async function PodcastAnalyticsPage({ params, searchParams }: PageProps) {
  const { podcastId } = await params;
  const sp = await searchParams;
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect('/auth/login');
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, title: true, userId: true },
  });

  if (!podcast) {
    notFound();
  }

  const role = ((session.user as Record<string, unknown>).role as string) ?? 'USER';
  if (podcast.userId !== userId && role !== 'ADMIN') {
    notFound();
  }

  const days = [7, 30, 90].includes(Number(sp.range)) ? Number(sp.range) : 30;
  const since = subDays(startOfDay(new Date()), days);

  const [overview, dailyPlays, retentionCurve, engagement, behavior, trafficSources] =
    await Promise.all([
      getPodcastOverview(podcastId),
      getPodcastDailyPlays(podcastId, since),
      getPodcastRetentionCurve(podcastId),
      getPodcastEngagement(podcastId),
      getPodcastListenerBehavior(podcastId),
      getPodcastTrafficSources(podcastId),
    ]);

  const maxDailyPlays = Math.max(...dailyPlays.map((d) => d.plays), 1);
  const maxSpeed = Math.max(...behavior.speedDistribution.map((s) => s.count), 1);
  const maxCompletion = Math.max(...behavior.completionDistribution.map((c) => c.count), 1);
  const maxRetention = retentionCurve
    ? Math.max(...retentionCurve.map((r) => r.abandonRate), 0.01)
    : 0;

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <Link href={`/podcast/${podcastId}`} className={styles.backLink}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to podcast
          </Link>
          <h1 className={styles.title}>{podcast.title || 'Untitled'}</h1>
          <p className={styles.subtitle}>Analytics</p>
        </div>
        <nav className={styles.rangeNav} aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/podcast/${podcastId}/analytics?range=${d}`}
              className={`${styles.rangeLink} ${days === d ? styles.rangeLinkActive : ''}`}
              aria-current={days === d ? 'page' : undefined}
            >
              {d}d
            </a>
          ))}
        </nav>
      </div>

      {/* Summary cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Plays</span>
          <span className={styles.cardValue}>{overview.plays.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Unique Listeners</span>
          <span className={styles.cardValue}>{overview.uniqueListeners.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Avg Completion</span>
          <span className={styles.cardValue}>{Math.round(overview.avgCompletion)}%</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Listen Hours</span>
          <span className={styles.cardValue}>{formatHours(overview.listenHours)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Likes</span>
          <span className={styles.cardValue}>{overview.likes.toLocaleString()}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Forks</span>
          <span className={styles.cardValue}>{overview.forks.toLocaleString()}</span>
        </div>
      </div>

      {/* Daily plays chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Daily Plays</h2>
        {dailyPlays.length === 0 ? (
          <p className={styles.empty}>No playback data for this period.</p>
        ) : (
          <div className={styles.chartContainer} role="img" aria-label="Daily plays bar chart">
            {dailyPlays.map((d) => (
              <div key={d.day} className={styles.chartBar}>
                <div
                  className={styles.chartBarFill}
                  style={{ height: `${(d.plays / maxDailyPlays) * 100}%` }}
                  title={`${d.day}: ${d.plays} plays`}
                />
                <span className={styles.chartLabel}>
                  {new Date(d.day + 'T00:00:00').toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Retention curve */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Retention Curve</h2>
        {!retentionCurve ? (
          <p className={styles.empty}>Not enough data yet. Retention data appears after feature computation.</p>
        ) : (
          <div className={styles.hBarContainer}>
            {retentionCurve.map((r) => (
              <div key={r.percentBucket} className={styles.hBarRow}>
                <span className={styles.hBarLabel}>{r.percentBucket}%</span>
                <div className={styles.hBarTrack}>
                  <div
                    className={styles.hBarFill}
                    style={{ width: `${(r.abandonRate / maxRetention) * 100}%` }}
                  />
                </div>
                <span className={styles.hBarValue}>{(r.abandonRate * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Engagement stats */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Engagement</h2>
        <div className={styles.engagementGrid}>
          {[
            { label: 'Likes', value: engagement.likes },
            { label: 'Saves', value: engagement.saves },
            { label: 'Comments', value: engagement.comments },
            { label: 'Forks', value: engagement.forks },
            { label: 'Q&A', value: engagement.interactions },
            { label: 'Upvotes', value: engagement.upvotes },
          ].map((item) => (
            <div key={item.label} className={styles.engagementItem}>
              <span className={styles.engagementValue}>{item.value.toLocaleString()}</span>
              <span className={styles.engagementLabel}>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Listener behavior */}
      <div className={styles.columns}>
        {behavior.completionDistribution.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Completion Distribution</h2>
            <div className={styles.hBarContainer}>
              {behavior.completionDistribution.map((c) => (
                <div key={c.bucket} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{c.bucket}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFill}
                      style={{ width: `${(c.count / maxCompletion) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>{c.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {behavior.speedDistribution.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Speed Distribution</h2>
            <div className={styles.hBarContainer}>
              {behavior.speedDistribution.map((s) => (
                <div key={s.speed} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{s.speed}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFillAccent}
                      style={{ width: `${(s.count / maxSpeed) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>{s.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Traffic sources */}
      {trafficSources && trafficSources.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Traffic Sources</h2>
          <div className={styles.hBarContainer}>
            {trafficSources.map((s) => (
              <div key={s.source} className={styles.hBarRow}>
                <span className={styles.hBarLabel}>{s.source}</span>
                <div className={styles.hBarTrack}>
                  <div
                    className={styles.hBarFillAccent}
                    style={{ width: `${s.percentage}%` }}
                  />
                </div>
                <span className={styles.hBarValue}>{s.percentage.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
