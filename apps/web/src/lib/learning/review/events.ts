import { z } from 'zod';
import type { LearningDatabase } from '../database';
import type { SrsState } from '../../srs';

export const reviewSnapshotSchema = z
  .object({
    ease: z.number().finite().nonnegative(),
    intervalDays: z.number().finite().nonnegative(),
    reps: z.number().int().nonnegative(),
    lapses: z.number().int().nonnegative(),
    mastery: z.number().min(0).max(1),
    dueAt: z.iso.datetime(),
    lastReviewed: z.iso.datetime().nullable(),
  })
  .strict();

export const assessmentSchema = z.enum(['VOCAB_CHOICE', 'READING_VOCABULARY', 'SECTION_AGGREGATE']);

export type ReviewSource =
  | { classId: string; attempt: number; practiceSessionId?: never }
  | { practiceSessionId: string; attempt: 1; classId?: never };

export interface ReviewEvidence {
  source: ReviewSource;
  assessment: z.infer<typeof assessmentSchema>;
  questionIdsByTarget: ReadonlyMap<string, readonly string[]>;
}

export function reviewSnapshot(state: SrsState & { dueAt: Date; lastReviewed: Date | null }) {
  return reviewSnapshotSchema.parse({
    ease: state.ease,
    intervalDays: state.intervalDays,
    reps: state.reps,
    lapses: state.lapses,
    mastery: state.mastery,
    dueAt: state.dueAt.toISOString(),
    lastReviewed: state.lastReviewed?.toISOString() ?? null,
  });
}

export async function recordReviewEvent(
  database: LearningDatabase,
  input: {
    courseId: string;
    vocabId?: string;
    grammarId?: string;
    targetKey: string;
    quality: number;
    reviewedAt: Date;
    before: z.infer<typeof reviewSnapshotSchema>;
    after: z.infer<typeof reviewSnapshotSchema>;
    evidence: ReviewEvidence;
  }
): Promise<void> {
  const { evidence, targetKey, ...event } = input;
  await database.learnerReviewEvent.create({
    data: {
      ...event,
      classId: evidence.source.classId,
      practiceSessionId: evidence.source.practiceSessionId,
      sourceAttempt: evidence.source.attempt,
      assessment: assessmentSchema.parse(evidence.assessment),
      questionIds: [...new Set(evidence.questionIdsByTarget.get(targetKey) ?? [])],
      schedulerVersion: 'sm2-v1',
    },
  });
}
