import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { ModerationTabs } from './ModerationTabs';
import styles from './page.module.css';

async function getModerationData() {
  const [failedPodcasts, feedbackEntries, pendingReportCount, pendingClaimCount, pendingVoiceCount] =
    await Promise.all([
      prisma.podcast.findMany({
        where: { status: 'FAILED' },
        select: {
          id: true,
          title: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.feedback.findMany({
        select: {
          id: true,
          type: true,
          subject: true,
          message: true,
          status: true,
          createdAt: true,
          email: true,
          name: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.claimReport.count({ where: { status: 'PENDING' } }),
      prisma.voiceClone.count({
        where: { verificationStatus: { in: ['PENDING_VERIFICATION', 'BLOCKED', 'AWAITING_CHALLENGE'] } },
      }),
    ]);

  return { failedPodcasts, feedbackEntries, pendingReportCount, pendingClaimCount, pendingVoiceCount };
}

export default async function AdminModerationPage() {
  const { failedPodcasts, feedbackEntries, pendingReportCount, pendingClaimCount, pendingVoiceCount } =
    await getModerationData();

  const failedPodcastsContent = (
    <>
      {failedPodcasts.length === 0 ? (
        <div className={styles.empty}>No failed podcasts</div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Creator</th>
                <th>Failed At</th>
              </tr>
            </thead>
            <tbody>
              {failedPodcasts.map((podcast) => {
                const creatorName =
                  podcast.user.name || podcast.user.email || 'Unknown';

                return (
                  <tr key={podcast.id}>
                    <td>
                      <Link
                        href={`/podcast/${podcast.id}`}
                        className={styles.link}
                      >
                        {podcast.title}
                      </Link>
                    </td>
                    <td className={styles.secondaryCell}>{creatorName}</td>
                    <td className={styles.dateCell}>
                      {new Date(podcast.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const feedbackContent = (
    <>
      {feedbackEntries.length === 0 ? (
        <div className={styles.empty}>No feedback entries</div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Subject</th>
                <th>Message</th>
                <th>From</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {feedbackEntries.map((entry) => {
                const from = entry.name || entry.email || 'Anonymous';

                return (
                  <tr key={entry.id}>
                    <td>
                      <span
                        className={`${styles.badge} ${styles[`badge${entry.type}`]}`}
                      >
                        {entry.type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className={styles.subjectCell}>{entry.subject}</td>
                    <td className={styles.messageCell}>{entry.message}</td>
                    <td className={styles.secondaryCell}>{from}</td>
                    <td>
                      <span
                        className={`${styles.badge} ${styles[`badge${entry.status}`]}`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className={styles.dateCell}>
                      {new Date(entry.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Moderation</h1>
        <p className={styles.subtitle}>
          Reports, moderation log, failed podcasts, and feedback
        </p>
      </div>

      <ModerationTabs
        pendingReportCount={pendingReportCount}
        pendingClaimCount={pendingClaimCount}
        failedPodcastCount={failedPodcasts.length}
        feedbackCount={feedbackEntries.length}
        pendingVoiceCount={pendingVoiceCount}
        failedPodcastsContent={failedPodcastsContent}
        feedbackContent={feedbackContent}
      />
    </div>
  );
}
