import type { Prisma } from '@/generated/prisma/client';
import { PlayRuleError } from '../errors';
import { loadPlayRoom, requirePlaySeat } from '../storage/room-view';
import { PlaySafetyError } from './policy';

/** A missing/private room is unavailable; it does not revoke a valid safety caller. */
export async function loadPlaySafetyParticipantRoom(
  database: Prisma.TransactionClient,
  roomId: string,
  userId: string
) {
  try {
    const room = await loadPlayRoom(database, roomId);
    return { room, seat: requirePlaySeat(room, userId) };
  } catch (error) {
    if (!(error instanceof PlayRuleError) || error.code !== 'forbidden') throw error;
    throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Game unavailable.');
  }
}
