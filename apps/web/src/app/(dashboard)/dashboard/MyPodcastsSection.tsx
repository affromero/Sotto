import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/Badge';
import { DeletePodcastButton } from '@/components/ui/DeletePodcastButton';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { Shield } from 'lucide-react';
import { getPodcastGradient } from '@/lib/podcast-gradient';
import { podcastUrl } from '@/lib/urls';
import type { PodcastStatus } from '@prisma/client';
import styles from './page.module.css';

interface MyPodcastsSectionProps {
  userId: string;
  userRole: string;
}

const statusVariants: Record<PodcastStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> =
  {
    DRAFT: 'default',
    PENDING: 'default',
    DISCOVERING: 'info',
    EXTRACTING: 'info',
    SCRIPTING: 'info',
    RESEARCHING: 'info',
    PLANNING: 'info',
    COMPILING: 'info',
    SCRIPT_READY: 'info',
    GENERATING_AUDIO: 'info',
    STITCHING: 'info',
    READY: 'success',
    UPDATING: 'warning',
    FAILED: 'error',
    IMPORTING: 'info',
    TRANSCRIBING: 'info',
    DUPLICATE_REVIEW: 'warning',
  };

const statusLabels: Record<PodcastStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  DISCOVERING: 'Discovering',
  EXTRACTING: 'Extracting',
  SCRIPTING: 'Scripting',
  RESEARCHING: 'Researching',
  PLANNING: 'Planning',
  COMPILING: 'Compiling',
  SCRIPT_READY: 'Script Ready',
  GENERATING_AUDIO: 'Generating',
  STITCHING: 'Stitching',
  READY: 'Ready',
  UPDATING: 'Updating',
  FAILED: 'Failed',
  IMPORTING: 'Importing...',
  TRANSCRIBING: 'Transcribing...',
  DUPLICATE_REVIEW: 'Under Review',
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export async function MyPodcastsSection({ userId, userRole }: MyPodcastsSectionProps) {
  const podcasts = await prisma.podcast.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      topic: true,
      status: true,
      duration: true,
      playCount: true,
      createdAt: true,
      audioUrl: true,
      source: true,
      sourcePlatform: true,
      isHumanContent: true,
      visibility: true,
      forkedFromId: true,
      failureReason: true,
      user: {
        select: { id: true, name: true, image: true, handle: true, role: true },
      },
      tags: {
        include: { tag: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  const isAdmin = userRole === 'ADMIN';

  return (
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
              <div
                key={podcast.id}
                className={`${styles.cardWrapper} dashboardCardWrapper`}
                role="listitem"
              >
                <Link
                  href={
                    podcast.status === 'DRAFT'
                      ? `/create?draftId=${podcast.id}`
                      : podcastUrl(podcast, podcast.user.handle)
                  }
                  className={styles.miniGradientCard}
                  style={gradientVars}
                  aria-label={`${podcast.title} - ${statusLabels[podcast.status]}`}
                >
                  <div
                    className={`${styles.miniGradientCover} ${podcast.status === 'FAILED' ? styles.miniGradientFailed : ''} ${podcast.status === 'DRAFT' ? styles.miniGradientDraft : ''}`}
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
                    <VisibilityToggle podcastId={podcast.id} visibility={podcast.visibility} />
                    <div className={styles.miniGradientMeta}>
                      {podcast.status === 'DRAFT' ? (
                        <span>Started {formatRelativeTime(podcast.createdAt)}</span>
                      ) : (
                        <>
                          <span>{formatDuration(podcast.duration)}</span>
                          <span>{formatDate(podcast.createdAt)}</span>
                          {podcast.playCount > 0 && (
                            <span>{podcast.playCount.toLocaleString()} plays</span>
                          )}
                        </>
                      )}
                    </div>
                    {podcast.status === 'DRAFT' && (
                      <span className={styles.draftHint}>Tap to continue</span>
                    )}
                    {podcast.status === 'FAILED' && (
                      <>
                        {isAdmin && podcast.failureReason && (
                          <p className={styles.failureReason}>{podcast.failureReason}</p>
                        )}
                        <span className={styles.retryHint}>Tap to retry</span>
                      </>
                    )}
                  </div>
                </Link>
                {podcast.status === 'FAILED' && isAdmin && (
                  <Link href={`/admin/podcasts?search=${podcast.id}`} className={styles.adminLink}>
                    <Shield size={12} />
                    Admin Panel
                  </Link>
                )}
                <DeletePodcastButton podcastId={podcast.id} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
