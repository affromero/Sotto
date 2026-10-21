import { PLAY_CONDUCT_VERSION } from '@sotto/shared';
import { Prisma } from '@/generated/prisma/client';
import { PlaySafetyError } from './policy';

export function playAdmissionParticipants(
  room: { hostUserId: string; guestUserId: string | null },
  candidate: { candidateUserId: string | null; provisionedUserId: string | null }
) {
  return [
    room.hostUserId,
    room.guestUserId,
    candidate.candidateUserId,
    candidate.provisionedUserId,
  ];
}

/** Lock the complete participant union before any room or admission write. */
export async function lockPlaySafetyParticipants(
  database: Prisma.TransactionClient,
  input: readonly (string | null | undefined)[]
) {
  const ids = [...new Set(input.filter((id): id is string => !!id))].sort();
  if (!ids.length) return [];
  await database.playSafetyState.createMany({
    data: ids.map((userId) => ({ userId })),
    skipDuplicates: true,
  });
  await database.$queryRaw(
    Prisma.sql`SELECT "userId" FROM "PlaySafetyState" WHERE "userId" IN (${Prisma.join(ids)}) ORDER BY array_position(ARRAY[${Prisma.join(ids)}]::text[], "userId") FOR UPDATE`
  );
  return database.playSafetyState.findMany({ where: { userId: { in: ids } } });
}

/** Caller holds the sorted participant fences, including on receipt recovery. */
export async function playInteractionUnavailable(
  database: Prisma.TransactionClient,
  input: readonly (string | null | undefined)[]
) {
  const ids = [...new Set(input.filter((id): id is string => !!id))];
  const states = await database.playSafetyState.findMany({ where: { userId: { in: ids } } });
  if (states.length !== ids.length || states.some((state) => state.sharingRestrictedAt))
    return true;
  return !!(await database.playUserBlock.findFirst({
    where: { blockerUserId: { in: ids }, blockedUserId: { in: ids } },
    select: { blockerUserId: true },
  }));
}

export async function requirePlayInteractionAllowed(
  database: Prisma.TransactionClient,
  ids: readonly (string | null | undefined)[],
  requireConduct = true
) {
  if (await playInteractionUnavailable(database, ids))
    throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Game unavailable.');
  if (!requireConduct) return;
  const participants = [...new Set(ids.filter((id): id is string => !!id))];
  const accepted = await database.playSafetyState.count({
    where: { userId: { in: participants }, conductVersion: PLAY_CONDUCT_VERSION },
  });
  if (accepted !== participants.length)
    throw new PlaySafetyError('CONDUCT_REQUIRED', 'Accept the game conduct terms before sharing.');
}

export async function fencePlaySafetyChange(database: Prisma.TransactionClient, ids: string[]) {
  await database.playSafetyState.updateMany({
    where: { userId: { in: ids } },
    data: { revision: { increment: 1 } },
  });
}
