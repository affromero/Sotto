import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TIER_LIMITS, type TierName } from '@/lib/stripe';
import { Badge } from '@/components/ui/Badge';
import type { PodcastStatus } from '@prisma/client';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

const statusVariants: Record<PodcastStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> =
  {
    PENDING: 'default',
    DISCOVERING: 'info',
    EXTRACTING: 'info',
    SCRIPTING: 'info',
    VERIFYING_SCRIPT: 'info',
    VALIDATING_REFERENCES: 'info',
    GENERATING_AUDIO: 'info',
    STITCHING: 'info',
    READY: 'success',
    UPDATING: 'warning',
    FAILED: 'error',
    IMPORTING: 'info',
    TRANSCRIBING: 'info',
  };

const statusLabels: Record<PodcastStatus, string> = {
  PENDING: 'Pending',
  DISCOVERING: 'Discovering',
  EXTRACTING: 'Extracting',
  SCRIPTING: 'Scripting',
  VERIFYING_SCRIPT: 'Fact-Checking',
  VALIDATING_REFERENCES: 'Verifying',
  GENERATING_AUDIO: 'Generating',
  STITCHING: 'Stitching',
  READY: 'Ready',
  UPDATING: 'Updating',
  FAILED: 'Failed',
  IMPORTING: 'Importing...',
  TRANSCRIBING: 'Transcribing...',
};

const tierLabels: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PRO: 'Pro',
  STUDIO: 'Studio',
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const userRole = ((session?.user as Record<string, unknown>)?.role as string) ?? 'USER';

  const [user, podcasts, trendingToFork] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        role: true,
        subscription: {
          select: {
            tier: true,
            status: true,
            creditsBalance: true,
            creditsMonthly: true,
          },
        },
        _count: {
          select: {
            followers: true,
          },
        },
      },
    }),
    prisma.podcast.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        topic: true,
        status: true,
        duration: true,
        playCount: true,
        forkCount: true,
        createdAt: true,
        audioUrl: true,
      },
    }),
    prisma.podcast.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
        userId: { not: userId },
      },
      orderBy: { forkCount: 'desc' },
      take: 4,
      select: {
        id: true,
        title: true,
        topic: true,
        forkCount: true,
        likeCount: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  const displayName = user?.name || 'there';
  const tier = (user?.subscription?.tier || 'FREE') as TierName;
  const creditsBalance = user?.subscription?.creditsBalance ?? 0;
  const creditsMonthly = user?.subscription?.creditsMonthly ?? TIER_LIMITS[tier].creditsMonthly;
  const isCreatorOrAdmin = userRole === 'CREATOR' || userRole === 'ADMIN';
  const totalListens = podcasts.reduce((sum, p) => sum + p.playCount, 0);
  const totalForks = podcasts.reduce((sum, p) => sum + p.forkCount, 0);
  const followerCount = user?._count?.followers ?? 0;

  return (
    <main className={styles.main}>
      <section className={styles.header}>
        <h1 className={styles.greeting}>Welcome back, {displayName}</h1>
        <Link href="/create" className={styles.createButton}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create New Podcast
        </Link>
      </section>

      <section className={styles.stats} aria-label="Usage statistics">
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Credit Balance</span>
          <span className={styles.statValue}>
            {creditsBalance}
            <span className={styles.statLimit}>
              / {creditsMonthly === Infinity ? 'Unlimited' : `${creditsMonthly} mo`}
            </span>
          </span>
          {creditsBalance === 0 && (
            <Link href="/billing" className={styles.outOfCreditsLink}>
              Get more credits
            </Link>
          )}
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Current Plan</span>
          <span className={styles.statValue}>{tierLabels[tier] || tier}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Podcasts</span>
          <span className={styles.statValue}>{podcasts.length}</span>
        </div>
      </section>

      {isCreatorOrAdmin && (
        <section className={styles.creatorStats} aria-label="Creator statistics">
          <h2 className={styles.creatorStatsTitle}>Creator Stats</h2>
          <div className={styles.creatorStatsGrid}>
            <div className={styles.creatorStatCard}>
              <span className={styles.statLabel}>Total Listens</span>
              <span className={styles.statValue}>{totalListens.toLocaleString()}</span>
            </div>
            <div className={styles.creatorStatCard}>
              <span className={styles.statLabel}>Followers</span>
              <span className={styles.statValue}>{followerCount.toLocaleString()}</span>
            </div>
            <div className={styles.creatorStatCard}>
              <span className={styles.statLabel}>Forks</span>
              <span className={styles.statValue}>{totalForks.toLocaleString()}</span>
            </div>
          </div>
        </section>
      )}

      <section className={styles.podcastsSection}>
        <h2 className={styles.sectionTitle}>My Podcasts</h2>

        {podcasts.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon} aria-hidden="true">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
                <path
                  d="M26 24L40 32L26 40V24Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className={styles.emptyTitle}>Create your first podcast</h3>
            <p className={styles.emptyText}>
              Chat with Sotto about any topic and generate a custom two-voice podcast in minutes.
            </p>
            <Link href="/create" className={styles.emptyCta}>
              Get Started
            </Link>
          </div>
        ) : (
          <ul className={styles.podcastList} role="list" aria-label="Your podcasts">
            {podcasts.map((podcast) => (
              <li key={podcast.id} className={styles.podcastItem}>
                <Link
                  href={`/podcast/${podcast.id}`}
                  className={styles.podcastLink}
                  aria-label={`${podcast.title} - ${statusLabels[podcast.status]}`}
                >
                  <div className={styles.podcastInfo}>
                    <h3 className={styles.podcastTitle}>{podcast.title}</h3>
                    <p className={styles.podcastTopic}>{podcast.topic}</p>
                  </div>
                  <div className={styles.podcastMeta}>
                    <Badge variant={statusVariants[podcast.status]}>
                      {statusLabels[podcast.status]}
                    </Badge>
                    {podcast.status === 'FAILED' && (
                      <span className={styles.retryHint}>Tap to retry</span>
                    )}
                    <span className={styles.podcastDuration}>
                      {formatDuration(podcast.duration)}
                    </span>
                    <time className={styles.podcastDate} dateTime={podcast.createdAt.toISOString()}>
                      {formatDate(podcast.createdAt)}
                    </time>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {trendingToFork.length > 0 && (
        <section className={styles.trendingSection} aria-label="Trending podcasts to fork">
          <div className={styles.trendingSectionHeader}>
            <h2 className={styles.sectionTitle}>Trending to Fork</h2>
            <Link href="/feed?sort=most_forked" className={styles.seeAllLink}>
              See all
            </Link>
          </div>
          <div className={styles.trendingGrid}>
            {trendingToFork.map((p) => (
              <div key={p.id} className={styles.trendingCard}>
                <Link href={`/podcast/${p.id}`} className={styles.trendingCardTitle}>
                  {p.title}
                </Link>
                <span className={styles.trendingCardMeta}>by {p.user.name || 'Anonymous'}</span>
                <div className={styles.trendingCardStats}>
                  <span className={styles.trendingCardStat}>{p.forkCount} forks</span>
                  <span className={styles.trendingCardStat}>{p.likeCount} likes</span>
                </div>
                <Link href={`/podcast/${p.id}`} className={styles.trendingForkBtn}>
                  Fork
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
