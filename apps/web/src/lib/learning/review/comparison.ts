import { createEmptyCard, default_w, fsrs, Rating, type Card } from 'ts-fsrs';
import { z } from 'zod';
import { reviewCard } from '../../srs';
import { assessmentSchema, reviewSnapshot, reviewSnapshotSchema } from './events';

export const comparisonEventSchema = z
  .object({
    sequence: z.string().regex(/^[1-9]\d*$/),
    target: z.string().min(1),
    assessment: assessmentSchema,
    questionIds: z.array(z.string()),
    quality: z.number().min(0).max(1),
    reviewedAt: z.iso.datetime(),
    schedulerVersion: z.string(),
    before: reviewSnapshotSchema,
    after: reviewSnapshotSchema,
  })
  .strict();
export type ComparisonEvent = z.infer<typeof comparisonEventSchema>;

function metrics(predictions: readonly { expected: number; predicted: number }[]) {
  if (!predictions.length) return null;
  let brier = 0;
  let logLoss = 0;
  let predictedSum = 0;
  let observedSum = 0;
  for (const { expected, predicted } of predictions) {
    const probability = Math.max(1e-6, Math.min(1 - 1e-6, predicted));
    brier += (predicted - expected) ** 2;
    predictedSum += predicted;
    observedSum += expected;
    logLoss -= expected * Math.log(probability) + (1 - expected) * Math.log(1 - probability);
  }
  return {
    observations: predictions.length,
    brier: brier / predictions.length,
    logLoss: logLoss / predictions.length,
    meanPrediction: predictedSum / predictions.length,
    observedRate: observedSum / predictions.length,
  };
}

function directChoice(event: ComparisonEvent): boolean {
  return (
    event.assessment === 'VOCAB_CHOICE' &&
    event.questionIds.length === 1 &&
    (event.quality === 0 || event.quality === 1) &&
    event.schedulerVersion === 'sm2-v1'
  );
}

/** Replay actual observation times with fixed parameters; never simulate a new study policy. */
export function compareReviewEvents(input: readonly ComparisonEvent[], testAfter: Date) {
  if (!Number.isFinite(testAfter.getTime()))
    throw new Error('A valid held-out cutoff is required.');
  const events = z
    .array(comparisonEventSchema)
    .parse(input)
    .sort((left, right) => {
      const time = Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt);
      if (time) return time;
      const a = BigInt(left.sequence);
      const b = BigInt(right.sequence);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  if (new Set(events.map((event) => event.sequence)).size !== events.length)
    throw new Error('Review event sequences must be unique.');
  const groups = Map.groupBy(events, (event) => event.target);
  const coverage = {
    events: events.length,
    targets: groups.size,
    eligibleTargets: 0,
    leftTruncatedTargets: 0,
    unsupportedHistoryTargets: 0,
    discontinuousHistoryTargets: 0,
    invalidReplayTargets: 0,
    excludedTailEvents: 0,
    warmupEvents: 0,
    coldStartEvents: 0,
    sameDayEvents: 0,
    heldOutObservations: 0,
    sm2ReplayMatches: 0,
    sm2ReplayMismatches: 0,
  };
  const fsrsPredictions: Array<{ expected: number; predicted: number }> = [];
  const masteryPredictions: Array<{ expected: number; predicted: number }> = [];
  const scheduler = fsrs({ enable_fuzz: false, w: [...default_w] });
  for (const history of groups.values()) {
    const first = history[0]!;
    if (
      first.before.lastReviewed !== null ||
      first.before.reps > 0 ||
      first.before.lapses > 0 ||
      first.before.intervalDays > 0
    ) {
      coverage.leftTruncatedTargets++;
      continue;
    }
    let card: Card = createEmptyCard(new Date(first.reviewedAt));
    let eligible = false;
    for (const [index, event] of history.entries()) {
      if (!directChoice(event)) {
        coverage.unsupportedHistoryTargets++;
        coverage.excludedTailEvents += history.length - index;
        break;
      }
      if (index > 0 && JSON.stringify(event.before) !== JSON.stringify(history[index - 1]!.after)) {
        coverage.discontinuousHistoryTargets++;
        coverage.excludedTailEvents += history.length - index;
        break;
      }
      const now = new Date(event.reviewedAt);
      const before = {
        ...event.before,
        dueAt: new Date(event.before.dueAt),
        lastReviewed: event.before.lastReviewed ? new Date(event.before.lastReviewed) : null,
      };
      const replayed = reviewSnapshot({
        ...reviewCard(before, event.quality, now),
        lastReviewed: now,
      });
      if (JSON.stringify(replayed) === JSON.stringify(event.after)) coverage.sm2ReplayMatches++;
      else {
        coverage.sm2ReplayMismatches++;
        coverage.invalidReplayTargets++;
        coverage.excludedTailEvents += history.length - index;
        break;
      }
      if (!eligible) {
        coverage.eligibleTargets++;
        eligible = true;
      }
      if (now < testAfter) coverage.warmupEvents++;
      else if (!card.last_review) coverage.coldStartEvents++;
      else if (now.getTime() - card.last_review.getTime() < 86_400_000) coverage.sameDayEvents++;
      else {
        fsrsPredictions.push({
          expected: event.quality,
          predicted: scheduler.get_retrievability(card, now, false),
        });
        masteryPredictions.push({ expected: event.quality, predicted: event.before.mastery });
        coverage.heldOutObservations++;
      }
      card = scheduler.next(card, now, event.quality === 1 ? Rating.Good : Rating.Again).card;
    }
  }
  return {
    evidence: 'single-question vocabulary recognition',
    testAfter: testAfter.toISOString(),
    fsrsParameters: [...default_w],
    ratingMapping: { incorrect: 'Again', correct: 'Good' },
    coverage,
    fsrsRecall: metrics(fsrsPredictions),
    currentMasteryBaseline: metrics(masteryPredictions),
    limitations: [
      'The mastery baseline is not an SM-2 recall probability.',
      'Predictions use actual review times; this does not measure a different scheduling policy or learning efficiency.',
      'Replay stops at the first aggregate, missing, unsupported, or invalid transition; prior predictions remain.',
      'Vocabulary recognition results do not establish free-recall performance.',
    ],
  };
}
