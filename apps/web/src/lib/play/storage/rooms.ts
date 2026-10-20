import { randomInt, randomUUID } from 'node:crypto';
import {
  createPlayRoomSchema,
  playGameConfigSchema,
  playRoomActionSchema,
  playRoundActionRequestSchema,
  playSettingsSchema,
  playPageQuerySchema,
  type PlayRoomView,
} from '@sotto/shared';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { advancePlayRound, createPlayRounds, readPrivatePlayRound } from '../engine';
import { PlayRuleError } from '../errors';
import { playFingerprint } from './fingerprint';
import { replayPlayAction } from './receipts';
import {
  loadPlayRoom,
  projectStoredPlayRoom,
  requirePlaySeat,
  type StoredPlayRoom,
} from './room-view';

export const PLAY_ROOM_TTL_MS = 2 * 60 * 60 * 1000;

export type PlayClock = () => Date;

export type PlayActor = {
  database: PrismaClient;
  request: Request;
  identity: AuthenticatedRequest;
};

type Mutation = {
  actionId: string;
  operation: string;
  fingerprint: string;
  roomId?: string;
};

async function replay(database: Prisma.TransactionClient, actor: PlayActor, mutation: Mutation) {
  await requireOriginalSottoAdmission(database, actor.request, actor.identity);
  if (mutation.roomId)
    requirePlaySeat(await loadPlayRoom(database, mutation.roomId), actor.identity.userId);
  return replayPlayAction(
    database,
    actor.identity.userId,
    mutation.actionId,
    mutation.operation,
    mutation.fingerprint
  );
}

async function mutate(
  actor: PlayActor,
  mutation: Mutation,
  apply: (database: Prisma.TransactionClient) => Promise<PlayRoomView>
): Promise<PlayRoomView> {
  try {
    return await sottoTransaction(actor.database, async (database) => {
      const previous = await replay(database, actor, mutation);
      if (previous) return previous;
      const result = await apply(database);
      await database.playActionReceipt.create({
        data: {
          roomId: mutation.roomId ?? result.id,
          actorUserId: actor.identity.userId,
          actionId: mutation.actionId,
          operation: mutation.operation,
          fingerprint: mutation.fingerprint,
          revision: result.revision,
          result,
        },
      });
      return result;
    });
  } catch (error) {
    // PostgreSQL may report a concurrent unique insert before an SSI conflict.
    // Only an authenticated, matching committed receipt can resolve that race.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    const previous = await sottoTransaction(actor.database, (database) =>
      replay(database, actor, mutation)
    );
    if (!previous) throw error;
    return previous;
  }
}

export function createStoredPlayRoom(
  actor: PlayActor,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = createPlayRoomSchema.parse(input);
  const roomId = randomUUID();
  return mutate(
    actor,
    {
      actionId: command.actionId,
      operation: 'CREATE',
      fingerprint: playFingerprint(command),
    },
    async (database) => {
      const now = clock();
      await database.playRoom.create({
        data: {
          id: roomId,
          hostUserId: actor.identity.userId,
          kind: command.kind,
          theme: command.theme,
          questionStyle: command.questionStyle ?? 'CHOICES',
          hostSettings: command.settings,
          createdAt: now,
          expiresAt: new Date(now.getTime() + PLAY_ROOM_TTL_MS),
        },
      });
      return projectStoredPlayRoom(
        database,
        await loadPlayRoom(database, roomId),
        actor.identity.userId,
        now
      );
    }
  );
}

export function readStoredPlayRoom(
  actor: PlayActor,
  roomId: string,
  clock: PlayClock = () => new Date()
) {
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    return projectStoredPlayRoom(
      database,
      await loadPlayRoom(database, roomId),
      actor.identity.userId,
      clock()
    );
  });
}

export function listStoredPlayRooms(
  actor: PlayActor,
  input: unknown = {},
  clock: PlayClock = () => new Date()
) {
  const query = playPageQuerySchema.parse(input);
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    const member = {
      OR: [{ hostUserId: actor.identity.userId }, { guestUserId: actor.identity.userId }],
    };
    if (
      query.beforeId &&
      !(await database.playRoom.findFirst({ where: { id: query.beforeId, ...member } }))
    )
      throw new PlayRuleError('forbidden', 'Game page unavailable.');
    const rooms = await database.playRoom.findMany({
      where: member,
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.beforeId ? { cursor: { id: query.beforeId }, skip: 1 } : {}),
    });
    const page = rooms.slice(0, query.limit);
    const now = clock();
    const views: PlayRoomView[] = [];
    for (const room of page)
      views.push(
        await projectStoredPlayRoom(
          database,
          await loadPlayRoom(database, room.id),
          actor.identity.userId,
          now
        )
      );
    return { rooms: views, nextCursor: rooms.length > query.limit ? page.at(-1)!.id : null };
  });
}

function requireCurrent(room: StoredPlayRoom, expectedRevision: number, now: Date) {
  if (room.revision !== expectedRevision)
    throw new PlayRuleError('conflict', 'The game changed. Refresh before acting.');
  if (room.expiresAt <= now && room.status !== 'COMPLETED')
    throw new PlayRuleError('conflict', 'This game has expired.');
}

async function bumpRevision(database: Prisma.TransactionClient, room: StoredPlayRoom) {
  const changed = await database.playRoom.updateMany({
    where: { id: room.id, revision: room.revision },
    data: { revision: { increment: 1 } },
  });
  if (changed.count !== 1) throw new PlayRuleError('conflict', 'The game changed. Refresh it.');
}

async function cancelRoom(database: Prisma.TransactionClient, roomId: string) {
  await database.playRoom.update({
    where: { id: roomId },
    data: { status: 'CANCELLED', invitationHash: null },
  });
  await database.playPresenceLease.deleteMany({ where: { roomId } });
  await database.playJoinRequest.updateMany({
    where: { roomId },
    data: { status: 'REVOKED', deliveryState: Prisma.DbNull },
  });
}

export function actOnStoredPlayRoom(
  actor: PlayActor,
  roomId: string,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const parsedRound = playRoundActionRequestSchema.safeParse(input);
  const command = parsedRound.success ? parsedRound.data : playRoomActionSchema.parse(input);
  const seed = randomInt(0, 2 ** 30);
  const rematchId = randomUUID();
  return mutate(
    actor,
    {
      roomId,
      actionId: command.actionId,
      operation: 'ACTION',
      fingerprint: playFingerprint({ roomId, command }),
    },
    async (database) => {
      const room = await loadPlayRoom(database, roomId);
      const now = clock();
      const seat = requirePlaySeat(room, actor.identity.userId);
      requireCurrent(room, command.expectedRevision, now);
      const view = await projectStoredPlayRoom(database, room, actor.identity.userId, now);
      if ('command' in command) {
        if (room.status !== 'PLAYING')
          throw new PlayRuleError('conflict', 'This game is not playing.');
        const active = room.rounds.find((round) => round.order === room.currentRound);
        if (!active) throw new PlayRuleError('invalid', 'The active round is missing.');
        const next = advancePlayRound(
          readPrivatePlayRound(active.privateState),
          seat,
          command.command
        );
        await bumpRevision(database, room);
        await database.playRound.update({
          where: { id: active.id },
          data: { privateState: next },
        });
      } else {
        if (!view.allowedActions.includes(command.type))
          throw new PlayRuleError('forbidden', 'That action is not available.');
        await bumpRevision(database, room);
        if (command.type === 'CANCEL' || command.type === 'LEAVE')
          await cancelRoom(database, roomId);
        else if (command.type === 'START') {
          const rounds = createPlayRounds(
            playGameConfigSchema.parse({
              kind: room.kind,
              theme: room.theme,
              questionStyle: room.questionStyle,
              players: { HOST: room.hostSettings, GUEST: room.guestSettings },
            }),
            seed
          );
          await database.playRound.createMany({
            data: rounds.map((round) => ({ roomId, order: round.order, privateState: round })),
          });
          await database.playRoom.update({
            where: { id: roomId },
            data: { status: 'PLAYING', invitationHash: null },
          });
          await database.playPresenceLease.deleteMany({ where: { roomId } });
        } else if (command.type === 'NEXT_ROUND') {
          await database.playRoom.update({
            where: { id: roomId },
            data:
              room.currentRound === room.rounds.length - 1
                ? { status: 'COMPLETED' }
                : { currentRound: { increment: 1 } },
          });
        } else {
          await database.playRoom.create({
            data: {
              id: rematchId,
              hostUserId: room.hostUserId,
              guestUserId: room.guestUserId,
              kind: room.kind,
              theme: room.theme,
              questionStyle: room.questionStyle,
              hostSettings: playSettingsSchema.parse(room.hostSettings),
              guestSettings: room.guestSettings
                ? playSettingsSchema.parse(room.guestSettings)
                : Prisma.DbNull,
              createdAt: now,
              expiresAt: new Date(now.getTime() + PLAY_ROOM_TTL_MS),
            },
          });
          await database.playRoom.update({
            where: { id: roomId },
            data: { rematchRoomId: rematchId },
          });
          return projectStoredPlayRoom(
            database,
            await loadPlayRoom(database, rematchId),
            actor.identity.userId,
            now
          );
        }
      }
      return projectStoredPlayRoom(
        database,
        await loadPlayRoom(database, roomId),
        actor.identity.userId,
        now
      );
    }
  );
}
