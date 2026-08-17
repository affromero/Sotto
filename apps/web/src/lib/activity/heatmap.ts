import { prisma } from '@/lib/prisma';

/**
 * Daily activity heatmap + streaks (GitHub-contribution style) for the learn hub.
 *
 * Sources are the three append-only submission tables only: PracticeSession
 * (per-skill kinds), ClassSubmission (gated classes), ExamSubmission (mock
 * exams). LearnerVocab/LearnerGrammar `lastReviewed` are deliberately NOT read:
 * they are mutable overwrite columns (no history), and every practice/class
 * submit stamps them anyway, so they would double-count and corrupt streaks.
 *
 * Days bucket in the learner's IANA timezone (User.timezone, welcome-wizard
 * pick); null falls back to the server's own timezone.
 */

export const ACTIVITY_CATEGORIES = [
  'full',
  'grammar',
  'reading',
  'listening',
  'speaking',
  'writing',
  'vocab',
  'class',
  'exam',
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export interface ActivityEvent {
  at: Date;
  category: ActivityCategory;
}

export type DayCounts = Partial<Record<ActivityCategory, number>>;

export interface ActivityData {
  timeZone: string;
  todayIso: string;
  /** ISO local-day (YYYY-MM-DD) → per-category counts. Days without activity are absent. */
  days: Map<string, DayCounts>;
  currentStreak: number;
  longestStreak: number;
}

/** Uppercase Prisma PracticeKind → heatmap category. */
const PRACTICE_KIND_CATEGORY: Record<string, ActivityCategory> = {
  FULL: 'full',
  GRAMMAR: 'grammar',
  READING: 'reading',
  LISTENING: 'listening',
  SPEAKING: 'speaking',
  WRITING: 'writing',
  VOCAB: 'vocab',
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Learner timezone, falling back to the server's own zone when unset/invalid. */
export function resolveTimezone(stored: string | null | undefined): string {
  if (stored && isValidTimezone(stored)) return stored;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Calendar day (YYYY-MM-DD) of an instant in the given timezone. */
export function localDayIso(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
}

export function bucketEvents(events: ActivityEvent[], timeZone: string): Map<string, DayCounts> {
  const days = new Map<string, DayCounts>();
  for (const { at, category } of events) {
    const iso = localDayIso(at, timeZone);
    const counts = days.get(iso) ?? {};
    counts[category] = (counts[category] ?? 0) + 1;
    days.set(iso, counts);
  }
  return days;
}

/** Previous calendar day of an ISO date, timezone-free (pure date arithmetic). */
function previousDayIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

/**
 * Streaks over a set of active ISO days. The current streak counts consecutive
 * days ending today, or yesterday when today has no activity yet (so the
 * streak isn't shown as broken before the learner practices today).
 */
export function computeStreaks(
  activeDays: Iterable<string>,
  todayIso: string
): { current: number; longest: number } {
  const active = new Set(activeDays);

  let current = 0;
  let cursor = active.has(todayIso) ? todayIso : previousDayIso(todayIso);
  while (active.has(cursor)) {
    current += 1;
    cursor = previousDayIso(cursor);
  }

  let longest = 0;
  for (const day of active) {
    if (active.has(previousDayIso(day))) continue; // not a run start
    let length = 0;
    let next = day;
    while (active.has(next)) {
      length += 1;
      const [y, m, d] = next.split('-').map(Number);
      next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    }
    longest = Math.max(longest, length);
  }

  return { current, longest };
}

const WINDOW_DAYS = 365;

export async function getActivityData(userId: string): Promise<ActivityData> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const timeZone = resolveTimezone(user?.timezone);

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [practice, classes, exams] = await Promise.all([
    prisma.practiceSession.findMany({
      where: { course: { userId }, completedAt: { gte: since } },
      select: { kind: true, completedAt: true },
    }),
    prisma.classSubmission.findMany({
      where: { userId, submittedAt: { gte: since } },
      select: { submittedAt: true },
    }),
    prisma.examSubmission.findMany({
      where: { exam: { userId }, submittedAt: { gte: since } },
      select: { submittedAt: true },
    }),
  ]);

  const events: ActivityEvent[] = [
    ...practice.flatMap((s): ActivityEvent[] => {
      const category = PRACTICE_KIND_CATEGORY[s.kind];
      return s.completedAt && category ? [{ at: s.completedAt, category }] : [];
    }),
    ...classes.map((s): ActivityEvent => ({ at: s.submittedAt, category: 'class' })),
    ...exams.map((s): ActivityEvent => ({ at: s.submittedAt, category: 'exam' })),
  ];

  const days = bucketEvents(events, timeZone);
  const todayIso = localDayIso(new Date(), timeZone);
  const { current, longest } = computeStreaks(days.keys(), todayIso);

  return { timeZone, todayIso, days, currentStreak: current, longestStreak: longest };
}
