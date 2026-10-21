import { Prisma } from '@/generated/prisma/client';

/** End active sharing and erase capabilities without revoking learning credentials. */
async function cancelMatchingPlayRooms(
  database: Prisma.TransactionClient,
  where: Prisma.PlayRoomWhereInput
) {
  await database.playRoom.updateMany({
    where: { ...where, status: { in: ['WAITING', 'PLAYING'] } },
    data: { status: 'CANCELLED', invitationHash: null, revision: { increment: 1 } },
  });
  await database.playPresenceLease.deleteMany({ where: { room: where } });
  await database.playJoinRequest.updateMany({
    where: { room: where },
    data: { status: 'REVOKED', deliveryState: Prisma.DbNull },
  });
}

export function cancelPlayRoomForSafety(database: Prisma.TransactionClient, roomId: string) {
  return cancelMatchingPlayRooms(database, { id: roomId });
}

export async function cancelBlockedPlayPair(
  database: Prisma.TransactionClient,
  first: string,
  second: string
) {
  await cancelMatchingPlayRooms(database, {
    OR: [
      { hostUserId: first, guestUserId: second },
      { hostUserId: second, guestUserId: first },
    ],
  });
  // A known pending candidate does not own the host's empty room or its other invitations.
  await database.playJoinRequest.updateMany({
    where: {
      OR: [
        {
          room: { hostUserId: first },
          OR: [{ candidateUserId: second }, { provisionedUserId: second }],
        },
        {
          room: { hostUserId: second },
          OR: [{ candidateUserId: first }, { provisionedUserId: first }],
        },
      ],
    },
    data: { status: 'REVOKED', deliveryState: Prisma.DbNull },
  });
}

export async function cancelRestrictedPlay(database: Prisma.TransactionClient, userId: string) {
  await cancelMatchingPlayRooms(database, {
    OR: [{ hostUserId: userId }, { guestUserId: userId }],
  });
  await database.playJoinRequest.updateMany({
    where: { OR: [{ candidateUserId: userId }, { provisionedUserId: userId }] },
    data: { status: 'REVOKED', deliveryState: Prisma.DbNull },
  });
}
