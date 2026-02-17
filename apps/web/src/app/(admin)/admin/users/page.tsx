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
  }>;
}

const USERS_PER_PAGE = 25;

async function getUsers(search: string | undefined, page: number) {
  const skip = (page - 1) * USERS_PER_PAGE;

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

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
        _count: {
          select: {
            podcasts: true,
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

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search;
  const page = parseInt(params.page ?? '1', 10);

  const session = await auth();
  const currentUserId = session?.user?.id;

  const { users, total, totalPages } = await getUsers(search, page);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Users</h1>
          <p className={styles.subtitle}>{total.toLocaleString()} total users</p>
        </div>
      </div>

      <form className={styles.searchForm} action="/admin/users" method="get">
        <input
          type="text"
          name="search"
          placeholder="Search by name or email..."
          defaultValue={search}
          className={styles.searchInput}
          aria-label="Search users"
        />
        <button type="submit" className={styles.searchButton}>
          Search
        </button>
      </form>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Tier</th>
              <th>Podcasts</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const displayName = user.name || user.email || 'Unknown';
              const initials = displayName.charAt(0).toUpperCase();
              const tier = 'FREE';

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
                      isOwnUser={user.id === currentUserId}
                      isBanned={!!user.bannedAt}
                      isSuspended={!!user.suspendedUntil && new Date(user.suspendedUntil) > new Date()}
                    />
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles[`badge${tier}`]}`}>{tier}</span>
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
              href={`/admin/users?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`}
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
              href={`/admin/users?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`}
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
