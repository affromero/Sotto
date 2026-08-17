import type { ActivityCategory, ActivityData, DayCounts } from '@/lib/activity/heatmap';
import styles from './ActivityHeatmap.module.css';

interface Props {
  data: ActivityData;
}

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  full: 'full practice',
  grammar: 'grammar',
  reading: 'reading',
  listening: 'listening',
  speaking: 'speaking',
  writing: 'writing',
  vocab: 'vocabulary',
  class: 'class',
  exam: 'exam',
};

const LEGEND: ActivityCategory[] = [
  'class',
  'grammar',
  'reading',
  'listening',
  'speaking',
  'writing',
  'vocab',
  'full',
  'exam',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_MS = 86400000;

interface Cell {
  iso: string;
  /** Leading grid alignment cell before the 365-day window — rendered invisible. */
  pad: boolean;
  counts: DayCounts | null;
  total: number;
  dominant: ActivityCategory | null;
  tier: 0 | 1 | 2 | 3 | 4;
}

function tierFor(total: number): Cell['tier'] {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total <= 3) return 2;
  if (total <= 6) return 3;
  return 4;
}

function dominantCategory(counts: DayCounts): ActivityCategory {
  let best: ActivityCategory = 'full';
  let bestCount = -1;
  for (const [category, count] of Object.entries(counts) as [ActivityCategory, number][]) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

function describe(counts: DayCounts): string {
  return Object.entries(counts)
    .map(([category, count]) => `${count} ${CATEGORY_LABELS[category as ActivityCategory]}`)
    .join(', ');
}

/**
 * Build week columns (Sunday-first) covering the 365 days ending on todayIso.
 * All date math is pure UTC arithmetic on the already-localized ISO day strings.
 */
function buildWeeks(data: ActivityData): Cell[][] {
  const [ty, tm, td] = data.todayIso.split('-').map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  const windowStart = today - 364 * DAY_MS;
  const gridStart = windowStart - new Date(windowStart).getUTCDay() * DAY_MS;

  const weeks: Cell[][] = [];
  for (let t = gridStart; t <= today;) {
    const week: Cell[] = [];
    for (let dow = 0; dow < 7 && t <= today; dow += 1, t += DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (t < windowStart) {
        week.push({ iso, pad: true, counts: null, total: 0, dominant: null, tier: 0 });
        continue;
      }
      const counts = data.days.get(iso) ?? null;
      const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
      week.push({
        iso,
        pad: false,
        counts,
        total,
        dominant: counts ? dominantCategory(counts) : null,
        tier: tierFor(total),
      });
    }
    weeks.push(week);
  }
  return weeks;
}

function cellTitle(cell: Cell): string {
  const [y, m, d] = cell.iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const label = `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[m - 1]} ${d}, ${y}`;
  return cell.counts ? `${label} — ${describe(cell.counts)}` : `${label} — no activity`;
}

/** Month label for a week column when it contains the 1st of a month. */
function monthLabel(week: Cell[]): string | null {
  const first = week.find((cell) => cell.iso.endsWith('-01'));
  if (!first) return null;
  return MONTHS[Number(first.iso.split('-')[1]) - 1];
}

/**
 * GitHub-style daily activity heatmap. Server component, no JS shipped: cells
 * carry data-cat/data-tier attributes and all colors live in the CSS module as
 * design tokens. The scroller starts at the right (most recent) edge via the
 * CSS direction trick, so mobile lands on today without a scroll script.
 */
export function ActivityHeatmap({ data }: Props) {
  const weeks = buildWeeks(data);
  const activeDayCount = data.days.size;

  return (
    <section className={styles.root} aria-labelledby="activity-heatmap-heading">
      <div className={styles.head}>
        <h2 id="activity-heatmap-heading" className={styles.heading}>
          Your activity
        </h2>
        <p className={styles.streaks}>
          <strong>{data.currentStreak}</strong> day streak · longest{' '}
          <strong>{data.longestStreak}</strong>
        </p>
      </div>
      <p className={styles.srSummary}>
        Active on {activeDayCount} of the last 365 days. Current streak {data.currentStreak}{' '}
        {data.currentStreak === 1 ? 'day' : 'days'}, longest streak {data.longestStreak}{' '}
        {data.longestStreak === 1 ? 'day' : 'days'}. Days bucket in {data.timeZone}.
      </p>
      <div className={styles.scroller}>
        <div
          className={styles.grid}
          role="img"
          aria-label={`Daily activity for the last year, ${activeDayCount} active days`}
        >
          {weeks.map((week) => (
            <div key={week[0].iso} className={styles.week}>
              <span className={styles.month}>{monthLabel(week) ?? ' '}</span>
              {week.map((cell) =>
                cell.pad ? (
                  <span key={cell.iso} className={styles.pad} />
                ) : (
                  <span
                    key={cell.iso}
                    className={styles.cell}
                    data-cat={cell.dominant ?? undefined}
                    data-tier={cell.tier}
                    title={cellTitle(cell)}
                  />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.legend} aria-hidden="true">
        {LEGEND.map((category) => (
          <span key={category} className={styles.legendItem}>
            <i className={styles.legendSwatch} data-cat={category} data-tier={4} />
            {CATEGORY_LABELS[category]}
          </span>
        ))}
      </div>
    </section>
  );
}
