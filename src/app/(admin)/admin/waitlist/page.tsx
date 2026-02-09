import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { ExportButton } from './ExportButton';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{
    page?: string;
  }>;
}

const WAITLIST_PER_PAGE = 25;

async function getWaitlist(page: number) {
  const skip = (page - 1) * WAITLIST_PER_PAGE;

  const [entries, total] = await Promise.all([
    prisma.waitlist.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: WAITLIST_PER_PAGE,
    }),
    prisma.waitlist.count(),
  ]);

  return { entries, total, totalPages: Math.ceil(total / WAITLIST_PER_PAGE) };
}

export default async function AdminWaitlistPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);

  const { entries, total, totalPages } = await getWaitlist(page);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Waitlist</h1>
          <p className={styles.subtitle}>{total.toLocaleString()} total signups</p>
        </div>
        <ExportButton />
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Source</th>
              <th>Signed Up</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className={styles.emailCell}>{entry.email}</td>
                <td>
                  <span className={styles.badge}>{entry.source ?? 'unknown'}</span>
                </td>
                <td className={styles.dateCell}>
                  {new Date(entry.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          {page > 1 && (
            <Link href={`/admin/waitlist?page=${page - 1}`} className={styles.pageButton}>
              Previous
            </Link>
          )}
          <span className={styles.pageInfo}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/admin/waitlist?page=${page + 1}`} className={styles.pageButton}>
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
