import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import styles from './page.module.css';

async function getModerationData() {
  const [failedPodcasts, feedbackEntries] = await Promise.all([
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
  ]);

  return { failedPodcasts, feedbackEntries };
}

export default async function AdminModerationPage() {
  const { failedPodcasts, feedbackEntries } = await getModerationData();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Moderation</h1>
        <p className={styles.subtitle}>Failed podcasts and user feedback</p>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Failed Podcasts ({failedPodcasts.length})</h2>
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
                  const creatorName = podcast.user.name || podcast.user.email || 'Unknown';

                  return (
                    <tr key={podcast.id}>
                      <td>
                        <Link href={`/podcast/${podcast.id}`} className={styles.link}>
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
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Feedback Entries ({feedbackEntries.length})</h2>
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
                        <span className={`${styles.badge} ${styles[`badge${entry.type}`]}`}>
                          {entry.type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className={styles.subjectCell}>{entry.subject}</td>
                      <td className={styles.messageCell}>{entry.message}</td>
                      <td className={styles.secondaryCell}>{from}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[`badge${entry.status}`]}`}>
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
      </div>
    </div>
  );
}
