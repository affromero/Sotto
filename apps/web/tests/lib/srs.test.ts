import { describe, it, expect } from 'vitest';
import { reviewCard, type SrsState } from '@/lib/srs';

const fresh: SrsState = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, mastery: 0 };
const NOW = new Date('2026-06-08T00:00:00.000Z');

describe('reviewCard (SM-2)', () => {
  it('schedules a passed new card 1 day out and raises mastery', () => {
    const u = reviewCard(fresh, 1, NOW);
    expect(u.reps).toBe(1);
    expect(u.intervalDays).toBe(1);
    expect(u.dueAt.getTime()).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(u.mastery).toBeGreaterThan(0);
    expect(u.lapses).toBe(0);
  });

  it('uses 6 days on the second successful review', () => {
    const first = reviewCard(fresh, 1, NOW);
    const second = reviewCard(first, 1, NOW);
    expect(second.reps).toBe(2);
    expect(second.intervalDays).toBe(6);
  });

  it('grows the interval by ease after the second review', () => {
    const a = reviewCard(fresh, 1, NOW);
    const b = reviewCard(a, 1, NOW);
    const c = reviewCard(b, 1, NOW);
    expect(c.reps).toBe(3);
    expect(c.intervalDays).toBeGreaterThan(6);
  });

  it('lapses a failed card: resets reps/interval, drops ease + mastery, due now', () => {
    const learned = reviewCard(reviewCard(fresh, 1, NOW), 1, NOW);
    const lapsed = reviewCard(learned, 0, NOW);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.intervalDays).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.ease).toBeLessThan(learned.ease);
    expect(lapsed.mastery).toBeLessThan(learned.mastery);
    expect(lapsed.dueAt.getTime()).toBe(NOW.getTime());
  });

  it('never lets ease fall below the 1.3 floor', () => {
    let s: SrsState = { ...fresh };
    for (let i = 0; i < 20; i++) s = reviewCard(s, 0, NOW);
    expect(s.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('treats 0.6 as the pass boundary', () => {
    expect(reviewCard(fresh, 0.6, NOW).reps).toBe(1);
    expect(reviewCard(fresh, 0.59, NOW).reps).toBe(0);
  });
});
