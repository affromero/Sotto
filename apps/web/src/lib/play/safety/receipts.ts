import { playSafetyCompletedSchema } from '@sotto/shared';
import { Prisma } from '@/generated/prisma/client';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { playFingerprint } from '../storage/fingerprint';
import type { PlayActor } from '../storage/rooms';
import { PlaySafetyError } from './policy';

/** Only an authenticated caller's own bounded acknowledgment can replay. */
export function mutatePlaySafety(
  actor: PlayActor,
  actionId: string,
  operation: 'CONDUCT' | 'BLOCK' | 'UNBLOCK' | 'REPORT' | 'REVIEW',
  input: unknown,
  apply: (database: Prisma.TransactionClient) => Promise<void>,
  authorize?: (database: Prisma.TransactionClient) => Promise<unknown>
) {
  const fingerprint = playFingerprint(input);
  const replay = async (database: Prisma.TransactionClient) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    await authorize?.(database);
    const receipt = await database.playSafetyReceipt.findUnique({
      where: { actorUserId_actionId: { actorUserId: actor.identity.userId, actionId } },
    });
    if (!receipt) return null;
    if (receipt.operation !== operation || receipt.fingerprint !== fingerprint)
      throw new PlaySafetyError('SAFETY_CONFLICT', 'That safety action ID has already been used.');
    return playSafetyCompletedSchema.parse(receipt.result);
  };
  const execute = () =>
    sottoTransaction(actor.database, async (database) => {
      const previous = await replay(database);
      if (previous) return previous;
      await apply(database);
      const result = playSafetyCompletedSchema.parse({ actionId, completed: true });
      await database.playSafetyReceipt.create({
        data: { actorUserId: actor.identity.userId, actionId, operation, fingerprint, result },
      });
      return result;
    });
  return execute().catch(async (error: unknown) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    const previous = await sottoTransaction(actor.database, replay);
    if (!previous) throw error;
    return previous;
  });
}
