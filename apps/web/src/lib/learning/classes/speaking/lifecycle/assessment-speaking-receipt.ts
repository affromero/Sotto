import { z } from 'zod';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';

const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Private receipt links a saved grade to the exact admitted recording and task. */
export const assessmentSpeakingReceiptSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    fingerprint: digest,
    recordingId: z.uuid(),
    inputDigest: digest,
    score: z.number().finite().min(0).max(1),
    gradeDigest: digest,
  })
  .strict();

export function assessmentSpeakingGradeDigest(grade: {
  transcript: string;
  overallScore: number;
  rubricScores: unknown;
  phonemeScores: unknown;
  feedback: string;
}) {
  return objectiveEvidenceHash({
    transcript: grade.transcript,
    overallScore: grade.overallScore,
    rubricScores: grade.rubricScores,
    phonemeScores: grade.phonemeScores,
    feedback: grade.feedback,
  });
}
