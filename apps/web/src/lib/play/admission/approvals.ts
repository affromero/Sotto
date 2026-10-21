import {
  approvePlayJoinSchema,
  playPendingRequestViewSchema,
  PLAY_CONDUCT_VERSION,
} from '@sotto/shared';
import { AccessError } from 'thesidedoor-core/access';
import { Prisma } from '@/generated/prisma/client';
import { createSottoProfile, prepareSottoProfile } from '@/lib/sidedoor/access/core/profiles';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { PlayRuleError } from '../errors';
import { playFingerprint } from '../storage/fingerprint';
import { loadPlayRoom } from '../storage/room-view';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { playSponsoringOwner, requireOrdinaryPlayEnrollment } from './authority';
import { loadPlayJoinRequest, projectPendingPlayRequest } from './views';
import {
  lockPlaySafetyParticipants,
  playAdmissionParticipants,
  requirePlayInteractionAllowed,
} from '../safety/fences';
import {
  assertPlayDisplayNameAllowed,
  assertPlaySharedTextAllowed,
  PlaySafetyError,
  redactPlayPublishedName,
} from '../safety/policy';

/** Prepare only after a real owner chooses enrollment, outside transaction retries. */
export async function approvePlayEntry(
  actor: PlayActor,
  requestId: string,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = approvePlayJoinSchema.parse(input);
  const captured = await actor.database.playJoinRequest.findUnique({ where: { id: requestId } });
  if (!captured) throw new AccessError('forbidden', 'Join request unavailable.');
  const prepared =
    command.type === 'APPROVE_PROFILE' &&
    captured.candidateKind === 'NEW' &&
    !captured.provisionedUserId &&
    captured.proposedName
      ? prepareSottoProfile(captured.proposedName)
      : null;
  const fingerprint = playFingerprint({ requestId, command });
  const identityInput = (candidate: typeof captured) =>
    playFingerprint({
      proposedName: candidate.proposedName,
      settings: candidate.settings,
      client: candidate.client,
      candidateKind: candidate.candidateKind,
      candidateUserId: candidate.candidateUserId,
      generation: candidate.generation,
      proofHash: candidate.proofHash,
      deviceName: candidate.deviceName,
      acceptedConductVersion: candidate.acceptedConductVersion,
      acceptedConductAt: candidate.acceptedConductAt?.toISOString() ?? null,
    });
  const capturedInput = identityInput(captured);

  const execute = () =>
    sottoTransaction(actor.database, async (database) => {
      await requireOriginalSottoAdmission(database, actor.request, actor.identity);
      const candidate = await loadPlayJoinRequest(database, requestId);
      const room = await loadPlayRoom(database, candidate.roomId);
      const now = clock();
      const isHost = room.hostUserId === actor.identity.userId;
      let sponsorId: string | null = null;
      if (command.type === 'APPROVE_PROFILE' || (!isHost && command.type === 'DECLINE'))
        sponsorId = await playSponsoringOwner(database, actor);
      if (!isHost && !(actor.identity.isOwner && candidate.candidateKind === 'NEW'))
        throw new AccessError('forbidden');
      const participants = playAdmissionParticipants(room, candidate);
      await lockPlaySafetyParticipants(database, participants);
      if (command.type !== 'DECLINE') {
        await requirePlayInteractionAllowed(database, participants);
        if (
          candidate.acceptedConductVersion !== PLAY_CONDUCT_VERSION ||
          !candidate.acceptedConductAt
        )
          throw new PlaySafetyError(
            'CONDUCT_REQUIRED',
            'The joining player must accept the game conduct terms.'
          );
        if (candidate.candidateKind === 'NEW')
          assertPlayDisplayNameAllowed(candidate.proposedName!);
        assertPlaySharedTextAllowed(candidate.deviceName);
      }
      const previous = await database.playActionReceipt.findUnique({
        where: {
          actorUserId_actionId: { actorUserId: actor.identity.userId, actionId: command.actionId },
        },
      });
      if (previous) {
        if (
          previous.operation !== 'APPROVE' ||
          previous.fingerprint !== fingerprint ||
          previous.roomId !== room.id
        )
          throw new PlayRuleError('conflict', 'That action ID has already been used.');
        const result = playPendingRequestViewSchema.parse(previous.result);
        return { ...result, name: redactPlayPublishedName(result.name) };
      }
      if (identityInput(candidate) !== capturedInput)
        throw new PlayRuleError('conflict', 'The enrollment request changed. Refresh it.');
      const view = await projectPendingPlayRequest(database, candidate, actor.identity, clock());
      if (command.type === 'APPROVE_PROFILE' && candidate.provisionedUserId && sponsorId) {
        requireOrdinaryPlayEnrollment(await (await sottoAccessStore(database)).read(), candidate);
        await database.playActionReceipt.create({
          data: {
            roomId: room.id,
            actorUserId: actor.identity.userId,
            actionId: command.actionId,
            operation: 'APPROVE',
            fingerprint,
            revision: room.revision,
            result: view,
          },
        });
        return view;
      }
      if (!view.allowedActions.includes(command.type))
        throw new PlayRuleError('forbidden', 'That approval is not available.');
      const changed = await database.playRoom.updateMany({
        where: {
          id: room.id,
          revision: command.expectedRevision,
          status: 'WAITING',
          guestUserId: null,
        },
        data: { revision: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PlayRuleError('conflict', 'The game changed. Refresh it.');

      if (command.type === 'DECLINE') {
        await database.playJoinRequest.update({
          where: { id: requestId },
          data: { status: 'DECLINED', deliveryState: Prisma.DbNull },
        });
      } else if (command.type === 'APPROVE_PROFILE') {
        if (!prepared || !sponsorId || candidate.candidateKind !== 'NEW')
          throw new AccessError('forbidden');
        const profile = await createSottoProfile(database, actor.request, prepared, null);
        await database.playSafetyState.create({
          data: {
            userId: profile.id,
            conductVersion: PLAY_CONDUCT_VERSION,
            acceptedAt: candidate.acceptedConductAt,
          },
        });
        await database.playJoinRequest.update({
          where: { id: requestId },
          data: {
            plannedProfileId: profile.id,
            provisionedUserId: profile.id,
            approvedByUserId: sponsorId,
            approvedAt: now,
            status: isHost ? 'ACCEPTED' : 'WAITING_FOR_HOST',
            acceptedAt: isHost ? now : null,
          },
        });
      } else {
        if (!isHost) throw new AccessError('forbidden');
        if (candidate.candidateKind === 'NEW')
          requireOrdinaryPlayEnrollment(await (await sottoAccessStore(database)).read(), candidate);
        await database.playJoinRequest.update({
          where: { id: requestId },
          data: { status: 'ACCEPTED', acceptedAt: now },
        });
      }
      if (command.type === 'ACCEPT' || (command.type === 'APPROVE_PROFILE' && isHost))
        await database.playJoinRequest.updateMany({
          where: {
            roomId: room.id,
            id: { not: requestId },
            status: { in: ['WAITING_FOR_OWNER', 'WAITING_FOR_HOST', 'ACCEPTED'] },
          },
          data: { status: 'REVOKED', deliveryState: Prisma.DbNull },
        });
      const result = await projectPendingPlayRequest(
        database,
        await loadPlayJoinRequest(database, requestId),
        actor.identity,
        now
      );
      await database.playActionReceipt.create({
        data: {
          roomId: room.id,
          actorUserId: actor.identity.userId,
          actionId: command.actionId,
          operation: 'APPROVE',
          fingerprint,
          revision: room.revision + 1,
          result,
        },
      });
      return result;
    });
  return execute().catch(async (error: unknown) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    return sottoTransaction(actor.database, async (database) => {
      await requireOriginalSottoAdmission(database, actor.request, actor.identity);
      const candidate = await loadPlayJoinRequest(database, requestId);
      await projectPendingPlayRequest(database, candidate, actor.identity, clock());
      if (command.type === 'APPROVE_PROFILE') await playSponsoringOwner(database, actor);
      const room = await loadPlayRoom(database, candidate.roomId);
      await lockPlaySafetyParticipants(database, playAdmissionParticipants(room, candidate));
      if (command.type !== 'DECLINE')
        await requirePlayInteractionAllowed(database, playAdmissionParticipants(room, candidate));
      const receipt = await database.playActionReceipt.findUnique({
        where: {
          actorUserId_actionId: { actorUserId: actor.identity.userId, actionId: command.actionId },
        },
      });
      if (!receipt || receipt.operation !== 'APPROVE' || receipt.fingerprint !== fingerprint)
        throw error;
      const result = playPendingRequestViewSchema.parse(receipt.result);
      return { ...result, name: redactPlayPublishedName(result.name) };
    });
  });
}
