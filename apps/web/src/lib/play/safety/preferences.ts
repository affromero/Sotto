import {
  PLAY_CONDUCT_VERSION,
  acceptPlayConductSchema,
  playBlockListSchema,
  playPageQuerySchema,
  playSafetyMutationSchema,
  playSafetyStatusSchema,
} from '@sotto/shared';
import { isAccessError } from 'thesidedoor-core/access';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { playSponsoringOwner } from '../admission/authority';
import { loadPlayRoom, requirePlaySeat } from '../storage/room-view';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { cancelBlockedPlayPair } from './cancellation';
import { fencePlaySafetyChange, lockPlaySafetyParticipants } from './fences';
import { PlaySafetyError, redactPlayPublishedName } from './policy';
import { mutatePlaySafety } from './receipts';

export function readPlaySafety(actor: PlayActor, clock: PlayClock = () => new Date()) {
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    const [state] = await lockPlaySafetyParticipants(database, [actor.identity.userId]);
    let canReviewReports = false;
    if (actor.identity.isOwner) {
      try {
        await playSponsoringOwner(database, actor);
        canReviewReports = true;
      } catch (error) {
        if (!isAccessError(error) || error.code !== 'forbidden') throw error;
      }
    }
    return playSafetyStatusSchema.parse({
      profileId: actor.identity.userId,
      acceptedVersion: state.conductVersion,
      acceptedAt: state.acceptedAt?.toISOString() ?? null,
      sharingRestricted: state.sharingRestrictedAt !== null,
      canReviewReports,
      serverTime: clock().toISOString(),
    });
  });
}

export function acceptPlayConduct(
  actor: PlayActor,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = acceptPlayConductSchema.parse(input);
  return mutatePlaySafety(actor, command.actionId, 'CONDUCT', command, async (database) => {
    await lockPlaySafetyParticipants(database, [actor.identity.userId]);
    await database.playSafetyState.update({
      where: { userId: actor.identity.userId },
      data: {
        conductVersion: PLAY_CONDUCT_VERSION,
        acceptedAt: clock(),
        revision: { increment: 1 },
      },
    });
  });
}

export function blockPlayPartner(
  actor: PlayActor,
  roomId: string,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = playSafetyMutationSchema.parse(input);
  return mutatePlaySafety(
    actor,
    command.actionId,
    'BLOCK',
    { roomId, command },
    async (database) => {
      const room = await loadPlayRoom(database, roomId);
      const seat = requirePlaySeat(room, actor.identity.userId);
      const other = seat === 'HOST' ? room.guestUserId : room.hostUserId;
      if (!other) throw new PlaySafetyError('PLAY_UNAVAILABLE', 'There is no partner to block.');
      await lockPlaySafetyParticipants(database, [actor.identity.userId, other]);
      await database.playUserBlock.upsert({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId: actor.identity.userId,
            blockedUserId: other,
          },
        },
        create: { blockerUserId: actor.identity.userId, blockedUserId: other, createdAt: clock() },
        update: {},
      });
      await fencePlaySafetyChange(database, [actor.identity.userId, other]);
      await cancelBlockedPlayPair(database, actor.identity.userId, other);
    }
  );
}

export function unblockPlayPartner(actor: PlayActor, blockedUserId: string, input: unknown) {
  const command = playSafetyMutationSchema.parse(input);
  return mutatePlaySafety(
    actor,
    command.actionId,
    'UNBLOCK',
    { blockedUserId, command },
    async (database) => {
      const block = await database.playUserBlock.findUnique({
        where: {
          blockerUserId_blockedUserId: { blockerUserId: actor.identity.userId, blockedUserId },
        },
      });
      if (!block) throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Blocked profile unavailable.');
      await lockPlaySafetyParticipants(database, [actor.identity.userId, blockedUserId]);
      await database.playUserBlock.delete({
        where: {
          blockerUserId_blockedUserId: { blockerUserId: actor.identity.userId, blockedUserId },
        },
      });
      await fencePlaySafetyChange(database, [actor.identity.userId, blockedUserId]);
    }
  );
}

export function listPlayBlocks(actor: PlayActor, input: unknown = {}) {
  const query = playPageQuerySchema.parse(input);
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    const own = { blockerUserId: actor.identity.userId };
    if (
      query.beforeId &&
      !(await database.playUserBlock.findFirst({
        where: { ...own, blockedUserId: query.beforeId },
      }))
    )
      throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Block page unavailable.');
    const rows = await database.playUserBlock.findMany({
      where: own,
      include: { blocked: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { blockedUserId: 'desc' }],
      take: query.limit + 1,
      ...(query.beforeId
        ? {
            cursor: { blockerUserId_blockedUserId: { ...own, blockedUserId: query.beforeId } },
            skip: 1,
          }
        : {}),
    });
    const page = rows.slice(0, query.limit);
    return playBlockListSchema.parse({
      blocks: page.map((row) => ({
        blockedUserId: row.blockedUserId,
        name: redactPlayPublishedName(row.blocked.name),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.blockedUserId : null,
    });
  });
}
