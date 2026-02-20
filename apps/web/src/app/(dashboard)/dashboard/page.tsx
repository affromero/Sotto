import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFreeTierStatus } from '@/lib/generation-gate';
import { Badge } from '@/components/ui/Badge';
import { FreeTierBanner } from '@/components/ui/FreeTierBanner';
import { PodcastCard } from '@/components/feed/PodcastCard';
import { DeletePodcastButton } from '@/components/ui/DeletePodcastButton';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { getPodcastGradient } from '@/lib/podcast-gradient';
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
    SCRIPT_READY: 'info',
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
  SCRIPT_READY: 'Script Ready',
  GENERATING_AUDIO: 'Generating',
  STITCHING: 'Stitching',
  READY: 'Ready',
  UPDATING: 'Updating',
  FAILED: 'Failed',
  IMPORTING: 'Importing...',
  TRANSCRIBING: 'Transcribing...',
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

  const [user, podcasts, trendingToFork, freeTier] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        role: true,
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
        likeCount: true,
        createdAt: true,
        audioUrl: true,
        source: true,
        sourcePlatform: true,
        isHumanContent: true,
        visibility: true,
        forkedFromId: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            handle: true,
            role: true,
          },
        },
        tags: {
          include: {
            tag: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
      },
    }),
    prisma.podcast.findMany({
      where: {
        status: 'READY',
        visibility: 'PUBLIC',
        userId: { not: userId },
      },
      orderBy: { forkCount: 'desc' },
      take: 6,
      select: {
        id: true,
        title: true,
        topic: true,
        status: true,
        visibility: true,
        audioUrl: true,
        duration: true,
        playCount: true,
        forkCount: true,
        likeCount: true,
        createdAt: true,
        source: true,
        sourcePlatform: true,
        isHumanContent: true,
        forkedFromId: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            handle: true,
            role: true,
          },
        },
        tags: {
          include: {
            tag: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
      },
    }),
    getFreeTierStatus(userId),
  ]);

  const displayName = user?.name || 'there';
  const isCreatorOrAdmin = userRole === 'CREATOR' || userRole === 'ADMIN';
  const totalListens = podcasts.reduce((sum, p) => sum + p.playCount, 0);
  const totalForks = podcasts.reduce((sum, p) => sum + p.forkCount, 0);
  const totalLikes = podcasts.reduce((sum, p) => sum + p.likeCount, 0);
  const followerCount = user?._count?.followers ?? 0;

  const serializedTrending = trendingToFork.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    tags: p.tags.map((pt) => pt.tag),
  }));

  return (
    <main className={styles.main}>
      <FreeTierBanner
        dailyUsed={freeTier.dailyUsed}
        dailyLimit={freeTier.dailyLimit}
        isByokUser={freeTier.isByokUser}
        isProUser={freeTier.isProUser}
        resetInSeconds={freeTier.resetInSeconds}
      />

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
        <div className={`${styles.statCard} ${styles.statPodcasts}`}>
          <span className={styles.statLabel}>Total Podcasts</span>
          <span className={styles.statValue}>{podcasts.length}</span>
        </div>
      </section>

      {isCreatorOrAdmin && (
        <section className={styles.creatorStats} aria-label="Creator statistics">
          <h2 className={styles.creatorStatsTitle}>Creator Stats</h2>
          <div className={styles.creatorStatsGrid}>
            <div className={`${styles.creatorStatCard} ${styles.statListens}`}>
              <span className={styles.statLabel}>Total Listens</span>
              <span className={styles.statValue}>{totalListens.toLocaleString()}</span>
            </div>
            <div className={`${styles.creatorStatCard} ${styles.statFollowers}`}>
              <span className={styles.statLabel}>Followers</span>
              <span className={styles.statValue}>{followerCount.toLocaleString()}</span>
            </div>
            <div className={`${styles.creatorStatCard} ${styles.statForks}`}>
              <span className={styles.statLabel}>Forks</span>
              <span className={styles.statValue}>{totalForks.toLocaleString()}</span>
            </div>
            <div className={`${styles.creatorStatCard} ${styles.statLikes}`}>
              <span className={styles.statLabel}>Likes</span>
              <span className={styles.statValue}>{totalLikes.toLocaleString()}</span>
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
              Chat with Sotto about any topic and generate a custom podcast in minutes.
            </p>
            <Link href="/create" className={styles.emptyCta}>
              Get Started
            </Link>
          </div>
        ) : (
          <div className={styles.podcastGrid} role="list" aria-label="Your podcasts">
            {podcasts.map((podcast) => {
              const gradient = getPodcastGradient(podcast.id);
              const gradientVars = {
                '--cover-from': gradient.from,
                '--cover-to': gradient.to,
                '--cover-angle': gradient.angle,
              } as React.CSSProperties;

              return (
                <div key={podcast.id} className={`${styles.cardWrapper} dashboardCardWrapper`} role="listitem">
                  <Link
                    href={`/podcast/${podcast.id}`}
                    className={styles.miniGradientCard}
                    style={gradientVars}
                    aria-label={`${podcast.title} - ${statusLabels[podcast.status]}`}
                  >
                    <div
                      className={`${styles.miniGradientCover} ${podcast.status === 'FAILED' ? styles.miniGradientFailed : ''}`}
                    >
                      <div className={styles.miniGradientBadge}>
                        <Badge variant={statusVariants[podcast.status]}>
                          {statusLabels[podcast.status]}
                        </Badge>
                      </div>
                      <h3 className={styles.miniGradientTitle}>{podcast.title}</h3>
                    </div>
                    <div className={styles.miniGradientBody}>
                      <p className={styles.miniGradientTopic}>{podcast.topic}</p>
                      <VisibilityToggle podcastId={podcast.id} visibility={podcast.visibility} canMakePrivate={freeTier.isByokUser || freeTier.isProUser} />
                      <div className={styles.miniGradientMeta}>
                        <span>{formatDuration(podcast.duration)}</span>
                        <span>{formatDate(podcast.createdAt)}</span>
                        {podcast.playCount > 0 && (
                          <span>{podcast.playCount.toLocaleString()} plays</span>
                        )}
                      </div>
                      {podcast.status === 'FAILED' && (
                        <span className={styles.retryHint}>Tap to retry</span>
                      )}
                    </div>
                  </Link>
                  <DeletePodcastButton podcastId={podcast.id} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {serializedTrending.length > 0 && (
        <section className={styles.trendingSection} aria-label="Trending podcasts to fork">
          <div className={styles.trendingSectionHeader}>
            <h2 className={styles.sectionTitle}>Trending to Fork</h2>
            <Link href="/feed?sort=most_forked" className={styles.seeAllLink}>
              See all
            </Link>
          </div>
          <div className={styles.trendingScroll}>
            {serializedTrending.map((p) => (
              <div key={p.id} className={styles.trendingCardWrapper}>
                <PodcastCard podcast={p} variant="compact" />
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
