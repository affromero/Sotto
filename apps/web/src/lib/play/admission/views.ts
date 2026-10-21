import { AccessError } from 'thesidedoor-core/access';
import {
  playJoinStatusViewSchema,
  PLAY_CONDUCT_VERSION,
  playPendingRequestViewSchema,
  type PlayPendingRequestView,
} from '@sotto/shared';
import type { PlayJoinRequest, Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { loadPlayRoom, playHostWaiting, type StoredPlayRoom } from '../storage/room-view';
import {
  lockPlaySafetyParticipants,
  playAdmissionParticipants,
  playInteractionUnavailable,
} from '../safety/fences';
import { redactPlayPublishedName } from '../safety/policy';

export async function loadPlayJoinRequest(database: Prisma.TransactionClient, requestId: string) {
  const candidate = await database.playJoinRequest.findUnique({ where: { id: requestId } });
  if (!candidate) throw new AccessError('forbidden', 'Join request unavailable.');
  return candidate;
}

async function playJoinStatus(
  database: Prisma.TransactionClient,
  candidate: PlayJoinRequest,
  room: StoredPlayRoom,
  now: Date
) {
  if (await playInteractionUnavailable(database, playAdmissionParticipants(room, candidate)))
    return 'REVOKED' as const;
  if (candidate.generation !== room.invitationGeneration || room.status === 'CANCELLED')
    return 'REVOKED' as const;
  if (['DECLINED', 'REVOKED', 'EXPIRED'].includes(candidate.status)) return candidate.status;
  if (room.status === 'EXPIRED' || (room.expiresAt <= now && room.status !== 'COMPLETED'))
    return 'EXPIRED' as const;
  if (candidate.status === 'CLAIMED') return 'CLAIMED' as const;
  if (candidate.expiresAt <= now) return 'EXPIRED' as const;
  if (candidate.status !== 'WAITING_FOR_OWNER' && !(await playHostWaiting(database, room.id, now)))
    return 'HOST_UNAVAILABLE' as const;
  return candidate.status;
}

export async function projectPlayJoinStatus(
  database: Prisma.TransactionClient,
  candidate: PlayJoinRequest,
  now: Date
) {
  const room = await loadPlayRoom(database, candidate.roomId);
  await lockPlaySafetyParticipants(database, playAdmissionParticipants(room, candidate));
  return playJoinStatusViewSchema.parse({
    requestId: candidate.id,
    status: await playJoinStatus(database, candidate, room, now),
    expiresAt: candidate.expiresAt.toISOString(),
    serverTime: now.toISOString(),
  });
}

/** Host/owner projection deliberately excludes proofs, credentials and ciphertext. */
export async function projectPendingPlayRequest(
  database: Prisma.TransactionClient,
  candidate: PlayJoinRequest,
  identity: AuthenticatedRequest,
  now: Date
): Promise<PlayPendingRequestView> {
  const room = await loadPlayRoom(database, candidate.roomId);
  const isHost = room.hostUserId === identity.userId;
  if (!isHost && !(identity.isOwner && candidate.candidateKind === 'NEW'))
    throw new AccessError('forbidden');
  await lockPlaySafetyParticipants(database, playAdmissionParticipants(room, candidate));
  const status = await playJoinStatus(database, candidate, room, now);
  const active =
    room.status === 'WAITING' &&
    room.expiresAt > now &&
    candidate.expiresAt > now &&
    candidate.generation === room.invitationGeneration &&
    !room.guestUserId &&
    ['WAITING_FOR_OWNER', 'WAITING_FOR_HOST', 'ACCEPTED'].includes(candidate.status) &&
    status !== 'REVOKED';
  const allowedActions: PlayPendingRequestView['allowedActions'] = [];
  if (active) {
    allowedActions.push('DECLINE');
    const hostWaiting = await playHostWaiting(database, room.id, now);
    if (
      identity.isOwner &&
      candidate.candidateKind === 'NEW' &&
      candidate.acceptedConductVersion === PLAY_CONDUCT_VERSION &&
      !candidate.provisionedUserId &&
      (!isHost || hostWaiting)
    )
      allowedActions.push('APPROVE_PROFILE');
    if (
      isHost &&
      candidate.status === 'WAITING_FOR_HOST' &&
      hostWaiting &&
      candidate.acceptedConductVersion === PLAY_CONDUCT_VERSION
    )
      allowedActions.push('ACCEPT');
  }
  const profileId = candidate.candidateUserId ?? candidate.provisionedUserId;
  const profile = profileId
    ? await database.user.findUnique({ where: { id: profileId }, select: { name: true } })
    : null;
  return playPendingRequestViewSchema.parse({
    requestId: candidate.id,
    roomId: room.id,
    roomRevision: room.revision,
    name: redactPlayPublishedName(profile?.name ?? candidate.proposedName),
    candidateKind: candidate.candidateKind,
    settings: candidate.settings,
    status,
    profileId,
    allowedActions,
    expiresAt: candidate.expiresAt.toISOString(),
    serverTime: now.toISOString(),
  });
}
