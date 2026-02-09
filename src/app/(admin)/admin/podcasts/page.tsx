import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    page?: string;
  }>;
}

const PODCASTS_PER_PAGE = 25;

async function getPodcasts(search: string | undefined, status: string | undefined, page: number) {
  const skip = (page - 1) * PODCASTS_PER_PAGE;

  const where: Record<string, any> = {};

  if (search) {
    where.title = { contains: search, mode: 'insensitive' };
  }

  if (status && status !== 'ALL') {
    where.status = status as any;
  }

  const [podcasts, total] = await Promise.all([
    prisma.podcast.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        playCount: true,
        visibility: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PODCASTS_PER_PAGE,
    }),
    prisma.podcast.count({ where }),
  ]);

  return { podcasts, total, totalPages: Math.ceil(total / PODCASTS_PER_PAGE) };
}

export default async function AdminPodcastsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search;
  const status = params.status ?? 'ALL';
  const page = parseInt(params.page ?? '1', 10);

  const { podcasts, total, totalPages } = await getPodcasts(search, status, page);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Podcasts</h1>
          <p className={styles.subtitle}>{total.toLocaleString()} total podcasts</p>
        </div>
      </div>

      <form className={styles.filters} action="/admin/podcasts" method="get">
        <input
          type="text"
          name="search"
          placeholder="Search by title..."
          defaultValue={search}
          className={styles.searchInput}
          aria-label="Search podcasts"
        />
        <select
          name="status"
          defaultValue={status}
          className={styles.statusSelect}
          aria-label="Filter by status"
        >
          <option value="ALL">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="DISCOVERING">Discovering</option>
          <option value="EXTRACTING">Extracting</option>
          <option value="SCRIPTING">Scripting</option>
          <option value="VERIFYING_SCRIPT">Verifying Script</option>
          <option value="VALIDATING_REFERENCES">Validating References</option>
          <option value="GENERATING_AUDIO">Generating Audio</option>
          <option value="STITCHING">Stitching</option>
          <option value="READY">Ready</option>
          <option value="UPDATING">Updating</option>
          <option value="FAILED">Failed</option>
        </select>
        <button type="submit" className={styles.searchButton}>
          Filter
        </button>
      </form>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Creator</th>
              <th>Status</th>
              <th>Plays</th>
              <th>Visibility</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {podcasts.map((podcast) => {
              const creatorName = podcast.user.name || podcast.user.email || 'Unknown';

              return (
                <tr key={podcast.id}>
                  <td>
                    <Link href={`/podcast/${podcast.id}`} className={styles.podcastLink}>
                      {podcast.title}
                    </Link>
                  </td>
                  <td className={styles.creatorCell}>{creatorName}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[`badge${podcast.status}`]}`}>
                      {podcast.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={styles.numberCell}>{podcast.playCount}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[`badge${podcast.visibility}`]}`}>
                      {podcast.visibility}
                    </span>
                  </td>
                  <td className={styles.dateCell}>
                    {new Date(podcast.createdAt).toLocaleDateString('en-US', {
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

      {totalPages > 1 && (
        <div className={styles.pagination}>
          {page > 1 && (
            <Link
              href={`/admin/podcasts?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ''}${status !== 'ALL' ? `&status=${status}` : ''}`}
              className={styles.pageButton}
            >
              Previous
            </Link>
          )}
          <span className={styles.pageInfo}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/podcasts?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ''}${status !== 'ALL' ? `&status=${status}` : ''}`}
              className={styles.pageButton}
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
