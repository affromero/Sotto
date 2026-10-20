import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { PlayClock } from './rooms';

/** Erase expired delivery secrets without deleting the owner's approved learner. */
export function expirePlayAdmissions(database: PrismaClient, clock: PlayClock = () => new Date()) {
  return sottoTransaction(database, async (transaction) => {
    const now = clock();
    const rooms = await transaction.playRoom.updateMany({
      where: { status: { in: ['WAITING', 'PLAYING'] }, expiresAt: { lte: now } },
      data: { status: 'EXPIRED', invitationHash: null },
    });
    const requests = await transaction.playJoinRequest.updateMany({
      where: {
        status: { in: ['WAITING_FOR_OWNER', 'WAITING_FOR_HOST', 'ACCEPTED'] },
        OR: [{ expiresAt: { lte: now } }, { room: { status: { in: ['CANCELLED', 'EXPIRED'] } } }],
      },
      data: { status: 'EXPIRED', deliveryState: Prisma.DbNull },
    });
    const deliveries = await transaction.playJoinRequest.updateMany({
      where: {
        deliveryState: { not: Prisma.DbNull },
        OR: [
          { deliveryExpiresAt: { lte: now } },
          { room: { status: { in: ['CANCELLED', 'EXPIRED'] } } },
        ],
      },
      data: { deliveryState: Prisma.DbNull },
    });
    const leases = await transaction.playPresenceLease.deleteMany({
      where: {
        OR: [
          { room: { status: { not: 'WAITING' } } },
          { room: { expiresAt: { lte: now } } },
          { releasedAt: null, expiresAt: { lte: now } },
        ],
      },
    });
    return {
      rooms: rooms.count,
      requests: requests.count,
      deliveries: deliveries.count,
      leases: leases.count,
    };
  });
}
