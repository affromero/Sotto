import { describe, expect, it } from 'vitest';
import { compareReviewEvents, type ComparisonEvent } from '@/lib/learning/review/comparison';
import { reviewSnapshot } from '@/lib/learning/review/events';
import { reviewCard } from '@/lib/srs';

function history(
  qualities = [1, 1, 0],
  dates = ['2026-01-01', '2026-01-03', '2026-01-08']
): ComparisonEvent[] {
  let state = {
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    mastery: 0.05,
    dueAt: new Date('2026-01-01T00:00:00Z'),
    lastReviewed: null as Date | null,
  };
  return qualities.map((quality, index) => {
    const now = new Date(`${dates[index]}T00:00:00Z`);
    const before = reviewSnapshot(state);
    state = { ...reviewCard(state, quality, now), lastReviewed: now };
    return {
      sequence: String(index + 1),
      target: 'vocab:opaque-target',
      assessment: 'VOCAB_CHOICE',
      questionIds: [`question-${index}`],
      quality,
      reviewedAt: now.toISOString(),
      schedulerVersion: 'sm2-v1',
      before,
      after: reviewSnapshot(state),
    };
  });
}
const cutoff = new Date('2026-01-07T00:00:00Z');

describe('offline recognition comparison', () => {
  it('scores held-out answers before observing their outcomes', () => {
    const correct = compareReviewEvents(history([1, 1, 1]), cutoff);
    const incorrect = compareReviewEvents(history([1, 1, 0]), cutoff);
    expect(correct.fsrsRecall?.meanPrediction).toBe(incorrect.fsrsRecall?.meanPrediction);
    expect(correct.currentMasteryBaseline?.meanPrediction).toBe(
      incorrect.currentMasteryBaseline?.meanPrediction
    );
    expect(correct.fsrsRecall?.observedRate).toBe(1);
    expect(incorrect.fsrsRecall?.observedRate).toBe(0);
    expect(correct.coverage).toMatchObject({
      warmupEvents: 2,
      heldOutObservations: 1,
      sm2ReplayMatches: 3,
      sm2ReplayMismatches: 0,
    });
  });

  it('reconstructs chronological history independently of input order', () => {
    const events = history();
    expect(compareReviewEvents([...events].reverse(), cutoff)).toEqual(
      compareReviewEvents(events, cutoff)
    );
  });

  it('reports no recall metrics for cold-start observations', () => {
    const report = compareReviewEvents(history([1], ['2026-01-08']), cutoff);
    expect(report.coverage.coldStartEvents).toBe(1);
    expect(report.fsrsRecall).toBeNull();
    expect(report.currentMasteryBaseline).toBeNull();
  });

  it('feeds same-day reviews into history while excluding them from held-out metrics', () => {
    const report = compareReviewEvents(
      history([1, 1, 0], ['2026-01-08', '2026-01-08', '2026-01-10']),
      cutoff
    );
    expect(report.coverage).toMatchObject({
      coldStartEvents: 1,
      sameDayEvents: 1,
      heldOutObservations: 1,
    });
  });

  it('excludes targets whose earlier reviews predate the journal', () => {
    const events = history();
    const report = compareReviewEvents(events.slice(1), cutoff);
    expect(report.coverage.leftTruncatedTargets).toBe(1);
    expect(report.fsrsRecall).toBeNull();
  });

  it('excludes histories containing aggregate evidence or missing intervening reviews', () => {
    const aggregate = history();
    aggregate[1]!.assessment = 'SECTION_AGGREGATE';
    expect(compareReviewEvents(aggregate, cutoff).coverage.unsupportedHistoryTargets).toBe(1);
    const missing = history();
    missing.splice(1, 1);
    expect(compareReviewEvents(missing, cutoff).coverage.discontinuousHistoryTargets).toBe(1);
  });

  it('rejects duplicate event identities instead of updating a card twice', () => {
    const events = history();
    expect(() => compareReviewEvents([...events, events[0]!], cutoff)).toThrow(/unique/);
  });

  it('stops replay when a recorded transition does not match the live scheduler', () => {
    const events = history();
    events.at(-1)!.after.mastery = 0.99;
    const report = compareReviewEvents(events, cutoff);
    expect(report.coverage).toMatchObject({
      invalidReplayTargets: 1,
      eligibleTargets: 1,
      heldOutObservations: 0,
      sm2ReplayMismatches: 1,
    });
    expect(report.fsrsRecall).toBeNull();
  });

  it.each(['unsupported', 'discontinuous', 'invalid'] as const)(
    'preserves earlier predictions when later history is %s',
    (kind) => {
      const events = history(
        [1, 1, 0, 1],
        ['2026-01-01', '2026-01-03', '2026-01-08', '2026-01-10']
      );
      const prior = compareReviewEvents(events.slice(0, 3), cutoff);
      const last = events.at(-1)!;
      if (kind === 'unsupported') last.assessment = 'SECTION_AGGREGATE';
      else if (kind === 'discontinuous') last.before.mastery = 0.99;
      else last.after.mastery = 0.99;
      const report = compareReviewEvents(events, cutoff);
      expect(report.fsrsRecall).toEqual(prior.fsrsRecall);
      expect(report.currentMasteryBaseline).toEqual(prior.currentMasteryBaseline);
      expect(report.coverage.heldOutObservations).toBe(1);
      expect(report.coverage.excludedTailEvents).toBe(1);
    }
  );
});
