import { playRoomViewSchema } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { PlayRuleError } from '../errors';

/** Membership and original credential must be checked before replaying a private receipt. */
export async function replayPlayAction(
  database: Prisma.TransactionClient,
  actorUserId: string,
  actionId: string,
  operation: string,
  fingerprint: string
) {
  const receipt = await database.playActionReceipt.findUnique({
    where: { actorUserId_actionId: { actorUserId, actionId } },
  });
  if (!receipt) return null;
  if (receipt.operation !== operation || receipt.fingerprint !== fingerprint)
    throw new PlayRuleError('conflict', 'That action ID has already been used.');
  return playRoomViewSchema.parse(receipt.result);
}
