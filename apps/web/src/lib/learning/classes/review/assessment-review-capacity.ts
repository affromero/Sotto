import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { readVerifiedAssessmentDrafts } from '../generation/assessment-draft';
import { capturePriorAssessmentExposure } from '../history/assessment-prior-exposure';
import { assessmentReviewPayload, reviewSectionsFromDrafts } from './assessment-review';

/** Check the complete staged review input before starting assessment audio. */
export async function requireAssessmentReviewCapacity(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string },
  execution: SottoProviderExecution
) {
  const { current, source, drafts } = await readVerifiedAssessmentDrafts(
    database,
    identity,
    execution
  );
  const prior = await capturePriorAssessmentExposure(database, {
    classId: current.classId,
    courseId: current.courseId,
    userId: current.userId,
    classAttempt: current.classAttempt,
    assessmentAttempt: current.assessmentAttempt,
  });
  const payload = assessmentReviewPayload(source, reviewSectionsFromDrafts(drafts), prior);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
