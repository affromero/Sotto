import { AccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { sottoStorageInstance } from '../sidedoor/access/state/store';

export async function materialStorageScopes(
  database: Prisma.TransactionClient,
  input: { id: string; userId: string; createdAt: Date }
) {
  const instance = await sottoStorageInstance(database).read();
  const user = await database.user.findUnique({
    where: { id: input.userId },
    select: { createdAt: true },
  });
  if (!user) throw new AccessError('unauthorized');
  return {
    instanceId: instance.instanceId,
    scopes: [
      { subjectId: instance.subjectId, generation: instance.generation },
      { subjectId: `profile:${input.userId}`, generation: user.createdAt.getTime() },
      { subjectId: `material:${input.id}`, generation: input.createdAt.getTime() },
    ].sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
  };
}
