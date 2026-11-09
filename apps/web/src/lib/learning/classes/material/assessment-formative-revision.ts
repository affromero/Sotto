import type { Prisma } from '@/generated/prisma/client';
import type { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import {
  classTaskMaterialHash,
  readInitialA1PracticeAuthorization,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { storedPrerequisiteAddendumSchema } from '@/lib/classes/help/lifecycle/prerequisite-contract';
import { readPrerequisiteSource } from '@/lib/classes/help/content/prerequisite-source';
import { readPrerequisiteStatus } from '@/lib/classes/help/prerequisite-status';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';

export class AssessmentNotRequiredError extends Error {
  constructor() {
    super('This class does not require an initial assessment.');
  }
}

/** Caller locks the owned class; publication must recheck this authorization and revision. */
export async function assessmentFormativeRevision(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: { adaptiveSeed: true },
  });
  if (!cls) throw new Error('The assessment class is unavailable.');
  const authorization = await readInitialA1PracticeAuthorization(database, classId, userId);
  if (!authorization) throw new AssessmentNotRequiredError();
  const baseMaterialHash = await classTaskMaterialHash(database, classId, userId);
  if (authorization.materialHash !== baseMaterialHash)
    throw new Error('Assessment teaching changed.');
  let teaching: Pick<
    z.infer<typeof storedPrerequisiteAddendumSchema>,
    'version' | 'sourceHash' | 'content'
  > | null = null;
  if (authorization.kind === 'ADDENDUM') {
    const seed = cls.adaptiveSeed;
    const raw =
      seed && typeof seed === 'object' && !Array.isArray(seed)
        ? seed.prerequisiteAddendum
        : undefined;
    const stored = storedPrerequisiteAddendumSchema.parse(raw);
    const source = await readPrerequisiteSource(database, classId, userId);
    const status = await readPrerequisiteStatus(database, classId, userId);
    if (
      status.status !== 'READY' ||
      !status.acknowledged ||
      status.receiptId !== authorization.receiptId ||
      status.request.sourceHash !== source.sourceHash ||
      status.request.snapshotHash !== source.hash ||
      stored.sourceHash !== source.sourceHash ||
      !isDeepStrictEqual(stored.content, status.content)
    )
      throw new Error('Assessment prerequisite teaching is no longer current.');
    teaching = { version: stored.version, sourceHash: stored.sourceHash, content: status.content };
  }
  return {
    revision: objectiveEvidenceHash({
      version: 2,
      baseMaterialHash,
      activeTeaching: { kind: authorization.kind, addendum: teaching },
    }),
    baseMaterialHash,
    addendum: teaching,
    teachingReceipt: { kind: authorization.kind, receiptId: authorization.receiptId },
  };
}
