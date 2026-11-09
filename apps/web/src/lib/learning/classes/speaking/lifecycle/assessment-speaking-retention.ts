import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { assessmentSpeakingPrelaunchReceiptId } from './assessment-speaking-prelaunch-receipt';

/** An erased job is safe to skip only after its private grant and proofs are gone. */
export async function hasRetainedAssessmentSpeakingState(
  database: Prisma.TransactionClient,
  operationId: string
) {
  return Boolean(
    await database.sidedoorState.findFirst({
      where: {
        id: {
          in: [
            `${SIDEDOOR_STATE_ID}:speaking-grant:${operationId}`,
            `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${operationId}`,
            assessmentSpeakingPrelaunchReceiptId(operationId),
          ],
        },
      },
      select: { id: true },
    })
  );
}
