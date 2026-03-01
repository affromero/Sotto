import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import Link from 'next/link';
import Image from 'next/image';
import { UserActions } from './UserActions';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    page?: string;
    tier?: string;
  }>;
}

const USERS_PER_PAGE = 25;

type TierFilter = 'ALL' | 'FREE' | 'PRO' | 'BYOK' | 'SUBSCRIBED';

function buildTierWhere(tier: TierFilter) {
  switch (tier) {
    case 'FREE':
      return { plan: 'FREE' as const };
    case 'PRO':
      return { plan: 'PRO' as const };
    case 'BYOK':
      return {
        OR: [
          { userAiKeys: { some: { isValid: true } } },
          { userTtsKeys: { some: { isValid: true } } },
        ],
      };
    case 'SUBSCRIBED':
      return { subscription: { status: 'active' } };
    default:
      return {};
  }
}

async function getUsers(search: string | undefined, page: number, tier: TierFilter) {
  const skip = (page - 1) * USERS_PER_PAGE;

  const searchWhere = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const tierWhere = buildTierWhere(tier);

  const where = { AND: [searchWhere, tierWhere] };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        createdAt: true,
        bannedAt: true,
        suspendedUntil: true,
        plan: true,
        dailyGenerationOverride: true,
        subscription: { select: { status: true, currentPeriodEnd: true } },
        _count: {
          select: {
            podcasts: true,
            userAiKeys: { where: { isValid: true } },
            userTtsKeys: { where: { isValid: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: USERS_PER_PAGE,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, totalPages: Math.ceil(total / USERS_PER_PAGE) };
}

function buildPaginationHref(page: number, search?: string, tier?: string) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (search) params.set('search', search);
  if (tier && tier !== 'ALL') params.set('tier', tier);
  return `/admin/users?${params.toString()}`;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search;
  const page = parseInt(params.page ?? '1', 10);
  const tier = (params.tier as TierFilter) || 'ALL';

  const session = await auth();
  const currentUserId = session?.user?.id;

  const { users, total, totalPages } = await getUsers(search, page, tier);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Users</h1>
          <p className={styles.subtitle}>{total.toLocaleString()} total users</p>
        </div>
      </div>

      <div className={styles.filterRow}>
        <form className={styles.searchForm} action="/admin/users" method="get">
          <input
            type="text"
            name="search"
            placeholder="Search by name or email..."
            defaultValue={search}
            className={styles.searchInput}
            aria-label="Search users"
          />
          {tier !== 'ALL' && <input type="hidden" name="tier" value={tier} />}
          <button type="submit" className={styles.searchButton}>
            Search
          </button>
        </form>

        <div className={styles.tierFilter}>
          {(['ALL', 'FREE', 'PRO', 'BYOK', 'SUBSCRIBED'] as const).map((t) => (
            <Link
              key={t}
              href={buildPaginationHref(1, search, t)}
              className={`${styles.filterChip} ${tier === t ? styles.filterChipActive : ''}`}
            >
              {t === 'ALL' ? 'All' : t === 'SUBSCRIBED' ? 'Subscribed' : t}
            </Link>
          ))}
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Tier</th>
              <th>Limit</th>
              <th>Podcasts</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const displayName = user.name || user.email || 'Unknown';
              const initials = displayName.charAt(0).toUpperCase();
              const hasByok = user._count.userAiKeys > 0 || user._count.userTtsKeys > 0;
              const subStatus = user.subscription?.status;

              return (
                <tr key={user.id}>
                  <td>
                    <div className={styles.userCell}>
                      <div className={styles.avatar}>
                        {user.image ? (
                          <Image
                            src={user.image}
                            alt={`${displayName}'s avatar`}
                            width={32}
                            height={32}
                          />
                        ) : (
                          initials
                        )}
                      </div>
                      <span className={styles.userName}>{displayName}</span>
                    </div>
                  </td>
                  <td className={styles.emailCell}>{user.email}</td>
                  <td>
                    <UserActions
                      userId={user.id}
                      currentRole={user.role}
                      currentPlan={user.plan}
                      dailyGenerationOverride={user.dailyGenerationOverride}
                      isOwnUser={user.id === currentUserId}
                      isBanned={!!user.bannedAt}
                      isSuspended={!!user.suspendedUntil && new Date(user.suspendedUntil) > new Date()}
                    />
                  </td>
                  <td>
                    <div className={styles.tierCell}>
                      <span className={`${styles.badge} ${styles[`badge${user.plan}`]}`}>
                        {user.plan}
                      </span>
                      {hasByok && (
                        <span className={`${styles.badge} ${styles.badgeBYOK}`}>BYOK</span>
                      )}
                      {subStatus === 'active' && (
                        <span className={styles.subDot} title="Active subscription" />
                      )}
                      {subStatus === 'canceled' && (
                        <span className={`${styles.subDot} ${styles.subDotCanceled}`} title="Canceled subscription" />
                      )}
                      {subStatus === 'past_due' && (
                        <span className={`${styles.subDot} ${styles.subDotPastDue}`} title="Past due subscription" />
                      )}
                    </div>
                  </td>
                  <td className={styles.limitCell}>
                    {user.dailyGenerationOverride === null
                      ? 'Global'
                      : user.dailyGenerationOverride === 0
                        ? 'Unlimited'
                        : `${user.dailyGenerationOverride}/day`}
                  </td>
                  <td className={styles.numberCell}>{user._count.podcasts}</td>
                  <td className={styles.dateCell}>
                    {new Date(user.createdAt).toLocaleDateString('en-US', {
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
              href={buildPaginationHref(page - 1, search, tier)}
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
              href={buildPaginationHref(page + 1, search, tier)}
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
