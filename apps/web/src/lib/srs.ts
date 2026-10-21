// SM-2-style spaced repetition. Pure functions over a card's SRS state so the
// scheduling math is unit-testable in isolation.
import { updateMasteryPosterior } from '@sotto/learning-model';

export interface SrsState {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  mastery: number; // 0..1 rolled-up strength
}

export interface SrsUpdate extends SrsState {
  dueAt: Date;
}

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;
const PASS_QUALITY = 0.6;

/**
 * Apply one review outcome to a card.
 * @param quality fraction correct for this review, 0..1. >= 0.6 counts as a pass.
 */
export function reviewSchedule(
  state: Omit<SrsState, 'mastery'>,
  quality: number,
  now: Date
): Omit<SrsUpdate, 'mastery'> {
  const q = Math.max(0, Math.min(1, quality));
  const passed = q >= PASS_QUALITY;
  let { ease, intervalDays, reps, lapses } = state;

  if (passed) {
    reps += 1;
    if (reps === 1) intervalDays = 1;
    else if (reps === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(intervalDays * ease));
    // SM-2 ease update, mapping quality 0..1 onto SM-2's q in 3..5.
    const sm2q = 3 + q * 2;
    ease = Math.max(MIN_EASE, ease + (0.1 - (5 - sm2q) * (0.08 + (5 - sm2q) * 0.02)));
  } else {
    reps = 0;
    lapses += 1;
    intervalDays = 0;
    ease = Math.max(MIN_EASE, ease - 0.2);
  }

  const dueAt = new Date(now.getTime() + Math.max(0, intervalDays) * DAY_MS);
  return { ease, intervalDays, reps, lapses, dueAt };
}

export function reviewCard(state: SrsState, quality: number, now: Date): SrsUpdate {
  return {
    ...reviewSchedule(state, quality, now),
    mastery: updateMasteryPosterior(state.mastery, { quality: Math.max(0, Math.min(1, quality)) }),
  };
}
