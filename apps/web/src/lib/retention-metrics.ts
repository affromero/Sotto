/**
 * Retention and active user queries for the admin dashboard.
 * All BehavioralEvent queries filter WHERE "userId" IS NOT NULL
 * to exclude anonymous page views.
 */

import { prisma } from './prisma';

export interface ActiveUsers {
  dau: number;
  wau: number;
  mau: number;
  stickiness: number;
}

export async function getDAU_WAU_MAU(): Promise<ActiveUsers> {
  const now = new Date();
  const dayAgo = new Date(now);
  dayAgo.setDate(dayAgo.getDate() - 1);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const [dauRow, wauRow, mauRow] = await Promise.all([
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "BehavioralEvent"
      WHERE "userId" IS NOT NULL AND "createdAt" >= ${dayAgo}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "BehavioralEvent"
      WHERE "userId" IS NOT NULL AND "createdAt" >= ${weekAgo}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "BehavioralEvent"
      WHERE "userId" IS NOT NULL AND "createdAt" >= ${monthAgo}
    `,
  ]);

  const dau = Number(dauRow[0]?.count ?? 0);
  const wau = Number(wauRow[0]?.count ?? 0);
  const mau = Number(mauRow[0]?.count ?? 0);

  return {
    dau,
    wau,
    mau,
    stickiness: mau > 0 ? dau / mau : 0,
  };
}

export async function getDailyActiveUsers(
  days: number
): Promise<Array<{ day: string; count: number }>> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
    WITH days AS (
      SELECT generate_series(${since}::date, NOW()::date, '1 day'::interval)::date AS day
    )
    SELECT
      d.day,
      COALESCE((
        SELECT COUNT(DISTINCT "userId")
        FROM "BehavioralEvent"
        WHERE "userId" IS NOT NULL
          AND "createdAt"::date = d.day
          AND "createdAt" >= ${since}
      ), 0)::bigint AS count
    FROM days d
    ORDER BY d.day ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString().split('T')[0],
    count: Number(r.count),
  }));
}

export interface CohortRow {
  cohortWeek: string;
  signups: number;
  retentionByWeek: number[];
}

export async function getRetentionCohorts(weeksBack: number = 12): Promise<CohortRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      cohort_week: Date;
      signups: bigint;
      week_offset: number;
      retained: bigint;
    }>
  >`
    WITH cohorts AS (
      SELECT
        id,
        DATE_TRUNC('week', "createdAt") AS cohort_week
      FROM "User"
      WHERE "createdAt" >= NOW() - (${weeksBack} || ' weeks')::interval
    ),
    activity AS (
      SELECT DISTINCT
        "userId",
        DATE_TRUNC('week', "createdAt") AS activity_week
      FROM "BehavioralEvent"
      WHERE "userId" IS NOT NULL
        AND "createdAt" >= NOW() - (${weeksBack} || ' weeks')::interval
    )
    SELECT
      c.cohort_week,
      COUNT(DISTINCT c.id)::bigint AS signups,
      EXTRACT(EPOCH FROM (a.activity_week - c.cohort_week))::int / 604800 AS week_offset,
      COUNT(DISTINCT a."userId")::bigint AS retained
    FROM cohorts c
    LEFT JOIN activity a ON a."userId" = c.id AND a.activity_week >= c.cohort_week
    GROUP BY c.cohort_week, week_offset
    ORDER BY c.cohort_week ASC, week_offset ASC
  `;

  const cohortMap = new Map<
    string,
    { signups: number; retention: Map<number, number> }
  >();

  for (const row of rows) {
    const weekKey = row.cohort_week.toISOString().split('T')[0];
    if (!cohortMap.has(weekKey)) {
      cohortMap.set(weekKey, { signups: Number(row.signups), retention: new Map() });
    }
    const cohort = cohortMap.get(weekKey)!;
    if (row.week_offset !== null) {
      cohort.retention.set(row.week_offset, Number(row.retained));
    }
  }

  const result: CohortRow[] = [];
  for (const [cohortWeek, data] of cohortMap) {
    const maxOffset = Math.max(...Array.from(data.retention.keys()), 0);
    const retentionByWeek: number[] = [];
    for (let i = 0; i <= Math.min(maxOffset, weeksBack); i++) {
      const retained = data.retention.get(i) ?? 0;
      retentionByWeek.push(data.signups > 0 ? (retained / data.signups) * 100 : 0);
    }
    result.push({ cohortWeek, signups: data.signups, retentionByWeek });
  }

  return result;
}
