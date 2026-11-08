import type { Prisma } from '@/generated/prisma/client';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import {
  classTaskMaterialHash,
  InitialA1PracticeBlocked,
  readInitialA1PracticeAuthorization,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { createPrerequisiteTokenizer } from '@/lib/classes/help/content/prerequisite-token';

/** Capture the owned material and its current teaching authorization in one transaction. */
export async function classProgressRevision(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const materialHash = await classTaskMaterialHash(database, classId, userId);
  let authorization;
  let blocked = false;
  try {
    authorization = await readInitialA1PracticeAuthorization(database, classId, userId);
  } catch (error) {
    if (!(error instanceof InitialA1PracticeBlocked)) throw error;
    blocked = true;
  }
  if (authorization && authorization.materialHash !== materialHash)
    throw new Error('Class progress material changed during authorization.');
  const binding = authorization
    ? objectiveEvidenceHash({
        version: 1,
        kind: 'CLASS_PROGRESS_TEACHING',
        materialHash,
        teachingKind: authorization.kind,
        receiptId: authorization.receiptId,
      })
    : materialHash;
  const tokenizer = createPrerequisiteTokenizer(classId, userId);
  try {
    return {
      revision: tokenizer.material(binding),
      access: blocked
        ? ('BLOCKED' as const)
        : authorization
          ? ('PROTECTED' as const)
          : ('UNPROTECTED' as const),
    };
  } finally {
    tokenizer.dispose();
  }
}
