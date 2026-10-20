import {
  playRoomViewSchema,
  playSettingsSchema,
  type PlayRoomView,
  type PlaySeat,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { PlayRuleError } from '../errors';
import { projectPlayRound } from '../projection';
import { playFingerprint } from './fingerprint';

export const storedRoomInclude = {
  host: { select: { id: true, name: true } },
  guest: { select: { id: true, name: true } },
  rounds: { orderBy: { order: 'asc' } },
} satisfies Prisma.PlayRoomInclude;
export type StoredPlayRoom = Prisma.PlayRoomGetPayload<{ include: typeof storedRoomInclude }>;

export function requirePlaySeat(room: StoredPlayRoom, userId: string): PlaySeat {
  if (room.hostUserId === userId) return 'HOST';
  if (room.guestUserId === userId) return 'GUEST';
  throw new PlayRuleError('forbidden', 'This game is private to its players.');
}

export async function loadPlayRoom(database: Prisma.TransactionClient, roomId: string) {
  const room = await database.playRoom.findUnique({
    where: { id: roomId },
    include: storedRoomInclude,
  });
  if (!room) throw new PlayRuleError('forbidden', 'Game unavailable.');
  return room;
}

export async function playHostWaiting(
  database: Prisma.TransactionClient,
  roomId: string,
  now: Date
): Promise<boolean> {
  const leases = await database.playPresenceLease.findMany({
    where: { roomId, releasedAt: null, expiresAt: { gt: now }, credentialExpiresAt: { gt: now } },
    select: { accessFingerprint: true },
  });
  if (leases.length === 0) return false;
  const fingerprint = playFingerprint(await (await sottoAccessStore(database)).read());
  return leases.some((lease) => lease.accessFingerprint === fingerprint);
}

/** Only personalized, schema-checked data crosses the storage boundary. */
export async function projectStoredPlayRoom(
  database: Prisma.TransactionClient,
  room: StoredPlayRoom,
  userId: string,
  now: Date
): Promise<PlayRoomView> {
  const ownSeat = requirePlaySeat(room, userId);
  const status =
    room.expiresAt <= now && !['COMPLETED', 'CANCELLED'].includes(room.status)
      ? 'EXPIRED'
      : room.status;
  const active = room.rounds.find((round) => round.order === room.currentRound);
  const round = active
    ? { id: active.id, ...projectPlayRound(active.privateState, ownSeat) }
    : null;
  const completedRounds = room.rounds
    .filter((item) => status === 'COMPLETED' || item.order < room.currentRound)
    .map((item) => ({ id: item.id, ...projectPlayRound(item.privateState, ownSeat) }));
  const points = room.rounds.reduce(
    (sum, item) => sum + (projectPlayRound(item.privateState, ownSeat).result?.points ?? 0),
    0
  );
  const allowedActions: PlayRoomView['allowedActions'] = [];
  if (status === 'WAITING') {
    allowedActions.push('LEAVE');
    if (ownSeat === 'HOST') {
      allowedActions.push('CANCEL');
      if (room.guest) allowedActions.push('START');
    }
  } else if (status === 'PLAYING') {
    allowedActions.push('LEAVE');
    if (round?.phase === 'FINISHED') allowedActions.push('NEXT_ROUND');
  } else if (status === 'COMPLETED' && ownSeat === 'HOST' && room.rematchRoomId === null)
    allowedActions.push('REMATCH');
  return playRoomViewSchema.parse({
    id: room.id,
    status,
    revision: room.revision,
    rematchRoomId: room.rematchRoomId,
    kind: room.kind,
    theme: room.theme,
    questionStyle: room.questionStyle,
    ownSeat,
    host: {
      id: room.host.id,
      name: room.host.name ?? 'Host',
      settings: playSettingsSchema.parse(room.hostSettings),
    },
    guest: room.guest
      ? {
          id: room.guest.id,
          name: room.guest.name ?? 'Partner',
          settings: playSettingsSchema.parse(room.guestSettings),
        }
      : null,
    hostWaiting: status === 'WAITING' && (await playHostWaiting(database, room.id, now)),
    allowedActions,
    round: status === 'PLAYING' ? round : null,
    completedRounds,
    points,
    serverTime: now.toISOString(),
  });
}
