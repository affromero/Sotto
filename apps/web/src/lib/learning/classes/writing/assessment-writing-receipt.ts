import { z } from 'zod';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';

export const assessmentWritingReceiptSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    assessmentId: z.string().min(1),
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    classAttempt: z.number().int().positive(),
    assessmentAttempt: z.number().int().positive(),
    sectionId: z.string().min(1),
    promptId: z.string().min(1),
    responseId: z.string().min(1),
    materialDigest: z.string().regex(/^[a-f0-9]{64}$/),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    textDigest: z.string().regex(/^[a-f0-9]{64}$/),
    score: z.number().finite().min(0).max(1),
    gradeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Bind the persisted grade fields, including private criterion evidence, to the receipt. */
export function assessmentWritingGradeDigest(grade: {
  overallScore: number;
  corrections: unknown;
  feedback: string;
  objectiveEvidence?: unknown;
}) {
  return objectiveEvidenceHash({
    overallScore: grade.overallScore,
    corrections: grade.corrections,
    feedback: grade.feedback,
    objectiveEvidence: grade.objectiveEvidence ?? null,
  });
}
