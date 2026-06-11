import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { ExportButton } from './ExportButton';
import { InvitationLinks } from './InvitationLinks';
import { WaitlistActions } from './WaitlistActions';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
  }>;
}

const WAITLIST_PER_PAGE = 25;
const VALID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

async function getWaitlist(page: number, statusFilter?: string) {
  const skip = (page - 1) * WAITLIST_PER_PAGE;
  const where = statusFilter && VALID_STATUSES.includes(statusFilter as typeof VALID_STATUSES[number])
    ? { status: statusFilter as typeof VALID_STATUSES[number] }
    : {};

  const [entries, total, counts] = await Promise.all([
    prisma.waitlist.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: WAITLIST_PER_PAGE,
    }),
    prisma.waitlist.count({ where }),
    prisma.waitlist.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  let allCount = 0;
  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const c of counts) {
    allCount += c._count._all;
    if (c.status === 'PENDING') pendingCount = c._count._all;
    if (c.status === 'APPROVED') approvedCount = c._count._all;
    if (c.status === 'REJECTED') rejectedCount = c._count._all;
  }

  return {
    entries,
    total,
    totalPages: Math.ceil(total / WAITLIST_PER_PAGE),
    counts: { all: allCount, PENDING: pendingCount, APPROVED: approvedCount, REJECTED: rejectedCount },
  };
}

export default async function AdminWaitlistPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10);
  const statusFilter = params.status;

  const [waitlistData, invitations] = await Promise.all([
    getWaitlist(page, statusFilter),
    prisma.invitationLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: { creator: { select: { name: true, email: true } } },
    }),
  ]);

  const { entries, total, totalPages, counts } = waitlistData;

  const now = new Date();
  const invitationsWithStatus = invitations.map((inv) => ({
    ...inv,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    usedAt: inv.usedAt?.toISOString() ?? null,
    status: inv.usedAt ? 'used' : !inv.enabled ? 'disabled' : inv.expiresAt < now ? 'expired' : 'active',
  }));

  const tabs = [
    { label: 'All', value: undefined, count: counts.all },
    { label: 'Pending', value: 'PENDING', count: counts.PENDING ?? 0 },
    { label: 'Approved', value: 'APPROVED', count: counts.APPROVED ?? 0 },
    { label: 'Rejected', value: 'REJECTED', count: counts.REJECTED ?? 0 },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Waitlist</h1>
          <p className={styles.subtitle}>{total.toLocaleString()} {statusFilter ? statusFilter.toLowerCase() : 'total'} entries</p>
        </div>
        <ExportButton />
      </div>

      <div className={styles.filterTabs}>
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.value ? `/admin/waitlist?status=${tab.value}` : '/admin/waitlist'}
            className={`${styles.filterTab} ${statusFilter === tab.value || (!statusFilter && !tab.value) ? styles.filterTabActive : ''}`}
          >
            {tab.label}
            <span className={styles.filterCount}>{tab.count}</span>
          </Link>
        ))}
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Source</th>
              <th>Referral</th>
              <th>Wishlist</th>
              <th>Status</th>
              <th>Signed Up</th>
              <th>Converted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className={styles.emailCell}>{entry.email}</td>
                <td>
                  <span className={styles.badge}>{entry.source ?? 'unknown'}</span>
                </td>
                <td className={styles.referralCell}>
                  {entry.referralCode ?? ''}
                </td>
                <td className={styles.wishlistCell} title={entry.wishlist ?? ''}>
                  {entry.wishlist ?? ''}
                </td>
                <td>
                  <span className={styles[`status${entry.status.charAt(0) + entry.status.slice(1).toLowerCase()}`]}>
                    {entry.status.toLowerCase()}
                  </span>
                </td>
                <td className={styles.dateCell}>
                  {new Date(entry.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </td>
                <td className={styles.dateCell}>
                  {entry.signedUpAt
                    ? new Date(entry.signedUpAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    : ''}
                </td>
                <td>
                  <WaitlistActions id={entry.id} status={entry.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          {page > 1 && (
            <Link
              href={`/admin/waitlist?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ''}`}
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
              href={`/admin/waitlist?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ''}`}
              className={styles.pageButton}
            >
              Next
            </Link>
          )}
        </div>
      )}

      <InvitationLinks initialInvitations={invitationsWithStatus} />
    </div>
  );
}
