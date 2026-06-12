import React from 'react';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { CreateAsSystemOwnerButton } from './CreateAsSystemOwnerButton';
import { CopyButton } from '@/components/admin/CopyButton';
import { CreateGitHubIssueButton } from './CreateGitHubIssueButton';
import { RetryButton } from './RetryButton';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    page?: string;
  }>;
}

const EPISODES_PER_PAGE = 25;

async function getEpisodes(search: string | undefined, status: string | undefined, page: number) {
  const skip = (page - 1) * EPISODES_PER_PAGE;

  const where: Record<string, any> = {};

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { id: search },
    ];
  }

  if (status && status !== 'ALL') {
    where.status = status as any;
  }

  const [episodes, total] = await Promise.all([
    prisma.episode.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        failedAtStatus: true,
        failureReason: true,
        technicalError: true,
        failedAt: true,
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
      take: EPISODES_PER_PAGE,
    }),
    prisma.episode.count({ where }),
  ]);

  return { episodes, total, totalPages: Math.ceil(total / EPISODES_PER_PAGE) };
}

export default async function AdminEpisodesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search;
  const status = params.status ?? 'ALL';
  const page = parseInt(params.page ?? '1', 10);

  const { episodes, total, totalPages } = await getEpisodes(search, status, page);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Lessons</h1>
          <p className={styles.subtitle}>{total.toLocaleString()} total lessons</p>
        </div>
        <CreateAsSystemOwnerButton />
      </div>

      <form className={styles.filters} action="/admin/episodes" method="get">
        <input
          type="text"
          name="search"
          placeholder="Search by title..."
          defaultValue={search}
          className={styles.searchInput}
          aria-label="Search lessons"
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
          <option value="RESEARCHING">Researching</option>
          <option value="PLANNING">Planning</option>
          <option value="COMPILING">Compiling</option>
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
              <th>Visibility</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {episodes.map((episode) => {
              const creatorName = episode.user.name || episode.user.email || 'Unknown';
              const isFailed = episode.status === 'FAILED';

              return (
                <React.Fragment key={episode.id}>
                  <tr>
                    <td>
                      <Link href={`/episode/${episode.id}`} className={styles.episodeLink}>
                        {episode.title}
                      </Link>
                    </td>
                    <td className={styles.creatorCell}>{creatorName}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge${episode.status}`]}`}>
                        {episode.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge${episode.visibility}`]}`}>
                        {episode.visibility}
                      </span>
                    </td>
                    <td className={styles.dateCell}>
                      {new Date(episode.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td>
                      {isFailed && (
                        <RetryButton episodeId={episode.id} />
                      )}
                    </td>
                  </tr>
                  {isFailed && (episode.failureReason || episode.technicalError) && (
                    <tr>
                      <td colSpan={6} className={styles.errorDetailCell}>
                        <div className={styles.errorDetail}>
                          {episode.failedAtStatus && (
                            <div>
                              <span className={styles.errorLabel}>Failed at stage</span>{' '}
                              <span>{episode.failedAtStatus.replace(/_/g, ' ')}</span>
                              {episode.failedAt && (
                                <span className={styles.errorLabel}>
                                  {' '}— {new Date(episode.failedAt).toLocaleString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}
                                </span>
                              )}
                            </div>
                          )}
                          {episode.failureReason && (
                            <div>
                              <span className={styles.errorLabel}>Reason:</span>{' '}
                              <span className={styles.errorReason}>{episode.failureReason}</span>
                              {' '}<CopyButton text={episode.failureReason} />
                            </div>
                          )}
                          {episode.technicalError && (
                            <div className={styles.errorTechnicalWrapper}>
                              <div className={styles.errorActions}>
                                <CopyButton text={episode.technicalError} />
                                <CreateGitHubIssueButton
                                  episodeId={episode.id}
                                  title={episode.title}
                                  creatorEmail={episode.user.email ?? ''}
                                  failedAtStatus={episode.failedAtStatus}
                                  failedAt={episode.failedAt?.toISOString() ?? null}
                                  failureReason={episode.failureReason}
                                  technicalError={episode.technicalError}
                                />
                              </div>
                              <pre className={styles.errorTechnical}>{episode.technicalError}</pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          {page > 1 && (
            <Link
              href={`/admin/episodes?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ''}${status !== 'ALL' ? `&status=${status}` : ''}`}
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
              href={`/admin/episodes?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ''}${status !== 'ALL' ? `&status=${status}` : ''}`}
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
