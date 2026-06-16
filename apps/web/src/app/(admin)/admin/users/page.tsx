import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import Link from 'next/link';
import Image from 'next/image';
import { UserActions } from './UserActions';
import { Glyph } from '@/components/Glyph';
import styles from '../../adminTheme.module.css';

export const metadata = { title: 'Users & access · Sotto admin' };

interface PageProps {
  searchParams: Promise<{ search?: string; page?: string }>;
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
        courses: {
          select: { startLevel: true, currentLevel: true, targetLang: true },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { episodes: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: USERS_PER_PAGE,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, totalPages: Math.ceil(total / USERS_PER_PAGE) };
}

function pageHref(page: number, search?: string) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (search) params.set('search', search);
  return `/admin/users?${params.toString()}`;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search;
  const page = parseInt(params.page ?? '1', 10);

  const session = await auth();
  const currentUserId = session?.user?.id;

  const { users, total, totalPages } = await getUsers(search, page);

  return (
    <>
      <div className={styles.adminHead}>
        <div>
          <h1>Users &amp; access</h1>
          <div className={styles.ahSub}>{total.toLocaleString()} learners · roles and levels</div>
        </div>
      </div>

      <form className={styles.searchRow} action="/admin/users" method="get">
        <input
          type="text"
          name="search"
          placeholder="Search by name or email"
          defaultValue={search}
          className={styles.searchInput}
          aria-label="Search learners"
        />
        <button type="submit" className={`${styles.btnSm} ${styles.primary}`}>
          <Glyph name="graph" size={13} /> Search
        </button>
      </form>

      <div className={styles.panel}>
        <table className={styles.dtable}>
          <thead>
            <tr>
              <th>Learner</th>
              <th>Role</th>
              <th>Level</th>
              <th>Lessons</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const displayName = user.name || user.email || 'Unknown';
              const initial = displayName.charAt(0).toUpperCase();
              const course = user.courses[0];
              const extra = user.courses.length - 1;
              return (
                <tr key={user.id}>
                  <td>
                    <div className={styles.uCell}>
                      <div className={styles.uAv}>
                        {user.image ? (
                          <Image src={user.image} alt="" width={30} height={30} />
                        ) : (
                          <span className={styles.ini}>{initial}</span>
                        )}
                      </div>
                      <div className={styles.uName}>
                        <b>{displayName}</b>
                        <span>{user.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <UserActions
                      userId={user.id}
                      currentRole={user.role}
                      isOwnUser={user.id === currentUserId}
                    />
                  </td>
                  <td className={styles.mono}>
                    {course ? (
                      <>
                        {course.startLevel} → {course.currentLevel} · {course.targetLang}
                        {extra > 0 && ` +${extra}`}
                      </>
                    ) : (
                      'n/a'
                    )}
                  </td>
                  <td className={styles.mono}>{user._count.episodes}</td>
                  <td className={`${styles.mono} ${styles.dimCell}`}>
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
            <Link href={pageHref(page - 1, search)} className={styles.btnSm}>
              <Glyph name="back" size={13} /> Previous
            </Link>
          )}
          <span className={styles.pageInfo}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageHref(page + 1, search)} className={styles.btnSm}>
              Next <Glyph name="arrow" size={13} />
            </Link>
          )}
        </div>
      )}
    </>
  );
}
