import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { storedPrerequisiteAddendumSchema } from './prerequisite-contract';
import { PrerequisiteSourceConflict } from '../content/prerequisite-source';
import { readPrerequisiteStatus } from '../prerequisite-status';

/** Bind an explicit learner action to the exact completed and still-current receipt. */
export async function acknowledgePrerequisite(
  database: Prisma.TransactionClient,
  input: { classId: string; userId: string; sourceHash: string; receiptId: string }
) {
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
  const current = await readPrerequisiteStatus(database, input.classId, input.userId);
  if (
    current.status !== 'READY' ||
    current.request.sourceHash !== input.sourceHash ||
    current.receiptId !== input.receiptId
  )
    throw new PrerequisiteSourceConflict();
  if (current.acknowledged) return current;
  const cls = await database.courseClass.findFirstOrThrow({
    where: { id: input.classId, course: { userId: input.userId } },
    select: { adaptiveSeed: true },
  });
  if (!cls.adaptiveSeed || typeof cls.adaptiveSeed !== 'object' || Array.isArray(cls.adaptiveSeed))
    throw new PrerequisiteSourceConflict();
  const stored = storedPrerequisiteAddendumSchema.parse(cls.adaptiveSeed.prerequisiteAddendum);
  const contentHash = createHash('sha256').update(JSON.stringify(stored.content)).digest('hex');
  await database.courseClass.update({
    where: { id: input.classId },
    data: {
      adaptiveSeed: {
        ...cls.adaptiveSeed,
        prerequisiteAddendum: {
          ...stored,
          acknowledgment: {
            userId: input.userId,
            sourceHash: input.sourceHash,
            receiptId: input.receiptId,
            contentHash,
          },
        },
      } as Prisma.InputJsonValue,
    },
  });
  return readPrerequisiteStatus(database, input.classId, input.userId);
}
