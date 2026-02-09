import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/Badge';
import type { PodcastStatus } from '@prisma/client';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

const statusVariants: Record<PodcastStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  PENDING: 'default',
  DISCOVERING: 'info',
  EXTRACTING: 'info',
  SCRIPTING: 'info',
  VALIDATING_REFERENCES: 'info',
  GENERATING_AUDIO: 'info',
  STITCHING: 'info',
  READY: 'success',
  UPDATING: 'warning',
  FAILED: 'error',
};

const statusLabels: Record<PodcastStatus, string> = {
  PENDING: 'Pending',
  DISCOVERING: 'Discovering',
  EXTRACTING: 'Extracting',
  SCRIPTING: 'Scripting',
  VALIDATING_REFERENCES: 'Verifying',
  GENERATING_AUDIO: 'Generating',
  STITCHING: 'Stitching',
  READY: 'Ready',
  UPDATING: 'Updating',
  FAILED: 'Failed',
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

  const [user, podcasts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        podcastsUsed: true,
        podcastsAllowed: true,
        subscription: {
          select: { tier: true, status: true },
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
        createdAt: true,
        audioUrl: true,
      },
    }),
  ]);

  const displayName = user?.name || 'there';
  const tier = user?.subscription?.tier || 'FREE';
  const podcastsUsed = user?.podcastsUsed ?? 0;
  const podcastsAllowed = user?.podcastsAllowed ?? 3;

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
          <span className={styles.statLabel}>Podcasts Created</span>
          <span className={styles.statValue}>
            {podcastsUsed}
            <span className={styles.statLimit}>/ {podcastsAllowed === -1 ? 'Unlimited' : podcastsAllowed}</span>
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Current Plan</span>
          <span className={styles.statValue}>{tier.charAt(0) + tier.slice(1).toLowerCase()}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Podcasts</span>
          <span className={styles.statValue}>{podcasts.length}</span>
        </div>
      </section>

      <section className={styles.podcastsSection}>
        <h2 className={styles.sectionTitle}>My Podcasts</h2>

        {podcasts.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon} aria-hidden="true">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
                <path d="M26 24L40 32L26 40V24Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
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
                    <span className={styles.podcastDuration}>{formatDuration(podcast.duration)}</span>
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
    </main>
  );
}
