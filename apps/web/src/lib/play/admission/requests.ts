import { AccessError, tokenHash } from 'thesidedoor-core/access';
import {
  playClaimantProofSchema,
  playConsentedJoinRequestSchema,
  acceptPendingPlayConductSchema,
  PLAY_CONDUCT_VERSION,
} from '@sotto/shared';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { PlayRuleError } from '../errors';
import { playFingerprint } from '../storage/fingerprint';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { projectPlayJoinStatus } from './views';
import {
  requirePlayBrowserContext,
  requireOrdinaryPlayEnrollment,
  type PlayBrowserContext,
} from './authority';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { loadPlayRoom } from '../storage/room-view';
import {
  lockPlaySafetyParticipants,
  playAdmissionParticipants,
  requirePlayInteractionAllowed,
} from '../safety/fences';
import {
  assertPlayDisplayNameAllowed,
  assertPlaySharedTextAllowed,
  PlaySafetyError,
} from '../safety/policy';

const JOIN_TTL_MS = 15 * 60 * 1000;

export function playProofHash(input: unknown) {
  const proof = playClaimantProofSchema.safeParse(input);
  if (!proof.success) throw new AccessError('unauthorized');
  return tokenHash(proof.data);
}

export async function requirePlayClaimant(
  database: Prisma.TransactionClient,
  requestId: string,
  proofHash: string
) {
  const candidate = await database.playJoinRequest.findFirst({
    where: { id: requestId, proofHash },
  });
  if (!candidate) throw new AccessError('unauthorized');
  return candidate;
}

/** Invitation requests record consent and proof, never a profile or a credential. */
export async function requestPlayEntry(
  database: PrismaClient,
  input: unknown,
  proof: unknown,
  actor: PlayActor | null,
  clock: PlayClock = () => new Date(),
  browserContext?: PlayBrowserContext
) {
  const command = playConsentedJoinRequestSchema.parse(input);
  const proofHash = playProofHash(proof);
  const candidateUserId = command.candidate.kind === 'EXISTING' ? actor?.identity.userId : null;
  if (command.candidate.kind === 'EXISTING' && !actor) throw new AccessError('unauthorized');
  const requireCandidate = async (transaction: Prisma.TransactionClient) => {
    if (command.candidate.kind === 'EXISTING' && actor) {
      await requireOriginalSottoAdmission(transaction, actor.request, actor.identity);
      if (actor.identity.userId !== command.candidate.expectedProfileId)
        throw new AccessError('conflict', 'Your active profile changed. Check it before joining.');
    }
    if (command.candidate.kind === 'NEW' && command.client === 'BROWSER') {
      if (browserContext?.expectedProfileId !== null) throw new AccessError('invalid');
      await requirePlayBrowserContext(transaction, browserContext);
    }
  };
  const fingerprint = playFingerprint({ command, candidateUserId, proofHash });
  const requireConsentedPair = async (
    transaction: Prisma.TransactionClient,
    hostUserId: string,
    participants: readonly (string | null | undefined)[],
    now: Date
  ) => {
    await lockPlaySafetyParticipants(transaction, participants);
    await requirePlayInteractionAllowed(transaction, participants, false);
    await requirePlayInteractionAllowed(transaction, [hostUserId]);
    if (candidateUserId) {
      // The current literal is explicit, fingerprint-bound consent by this exact actor.
      await transaction.playSafetyState.updateMany({
        where: {
          userId: candidateUserId,
          OR: [
            { conductVersion: null },
            { conductVersion: { not: command.acceptedConductVersion } },
          ],
        },
        data: {
          conductVersion: command.acceptedConductVersion,
          acceptedAt: now,
          revision: { increment: 1 },
        },
      });
    }
    await requirePlayInteractionAllowed(transaction, participants);
  };
  const operation = () =>
    sottoTransaction(database, async (transaction) => {
      const now = clock();
      await requireCandidate(transaction);
      const previous = await transaction.playJoinRequest.findUnique({
        where: { id: command.requestId },
      });
      if (previous) {
        if (previous.proofHash !== proofHash) throw new AccessError('unauthorized');
        if (previous.fingerprint !== fingerprint)
          throw new PlayRuleError('conflict', 'That join request ID has already been used.');
        const room = await loadPlayRoom(transaction, previous.roomId);
        await requireConsentedPair(
          transaction,
          room.hostUserId,
          playAdmissionParticipants(room, previous),
          now
        );
        return projectPlayJoinStatus(transaction, previous, now);
      }
      const room = await transaction.playRoom.findUnique({
        where: { invitationHash: tokenHash(command.code) },
      });
      if (!room || room.status !== 'WAITING' || room.expiresAt <= now || room.guestUserId)
        throw new AccessError('forbidden', 'Invitation unavailable.');
      if (room.hostUserId === candidateUserId)
        throw new PlayRuleError('conflict', 'You already host this game.');
      await requireConsentedPair(
        transaction,
        room.hostUserId,
        [room.hostUserId, candidateUserId],
        now
      );
      if (command.candidate.kind === 'NEW') assertPlayDisplayNameAllowed(command.candidate.name);
      assertPlaySharedTextAllowed(command.deviceName);
      const requests = await transaction.playJoinRequest.findMany({
        where: {
          roomId: room.id,
          generation: room.invitationGeneration,
          expiresAt: { gt: now },
          status: { in: ['WAITING_FOR_OWNER', 'WAITING_FOR_HOST', 'ACCEPTED', 'CLAIMED'] },
        },
        select: { status: true },
        take: 10,
      });
      if (requests.some((request) => ['ACCEPTED', 'CLAIMED'].includes(request.status)))
        throw new PlayRuleError('conflict', 'This game is waiting for its accepted player.');
      if (requests.length >= 10) throw new AccessError('rate_limited');
      const candidate = await transaction.playJoinRequest.create({
        data: {
          id: command.requestId,
          roomId: room.id,
          generation: room.invitationGeneration,
          candidateKind: command.candidate.kind,
          candidateUserId,
          proposedName: command.candidate.kind === 'NEW' ? command.candidate.name : null,
          settings: command.candidate.settings,
          client: command.client,
          deviceName: command.deviceName,
          proofHash,
          fingerprint,
          status: command.candidate.kind === 'NEW' ? 'WAITING_FOR_OWNER' : 'WAITING_FOR_HOST',
          createdAt: now,
          acceptedConductVersion: command.acceptedConductVersion,
          acceptedConductAt: now,
          expiresAt: new Date(Math.min(now.getTime() + JOIN_TTL_MS, room.expiresAt.getTime())),
        },
      });
      return projectPlayJoinStatus(transaction, candidate, now);
    });
  return operation().catch(async (error: unknown) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    return sottoTransaction(database, async (transaction) => {
      const now = clock();
      await requireCandidate(transaction);
      const previous = await transaction.playJoinRequest.findUnique({
        where: { id: command.requestId },
      });
      if (!previous)
        throw new PlayRuleError('conflict', 'Use a fresh proof for each join request.');
      if (previous.proofHash !== proofHash) throw new AccessError('unauthorized');
      if (previous.fingerprint !== fingerprint)
        throw new PlayRuleError('conflict', 'That join request ID has already been used.');
      const room = await loadPlayRoom(transaction, previous.roomId);
      await requireConsentedPair(
        transaction,
        room.hostUserId,
        playAdmissionParticipants(room, previous),
        now
      );
      return projectPlayJoinStatus(transaction, previous, now);
    });
  });
}

/** Explicit proof-bound consent can recover a live legacy request, never create a profile. */
export function acceptPendingPlayConduct(
  database: PrismaClient,
  requestId: string,
  proof: unknown,
  input: unknown,
  actor: PlayActor | null,
  clock: PlayClock = () => new Date(),
  browserContext?: PlayBrowserContext
) {
  const command = acceptPendingPlayConductSchema.parse(input);
  const proofHash = playProofHash(proof);
  return sottoTransaction(database, async (transaction) => {
    const candidate = await requirePlayClaimant(transaction, requestId, proofHash);
    if (candidate.client === 'BROWSER') {
      if (
        !('expectedProfileId' in command) ||
        command.expectedProfileId !== browserContext?.expectedProfileId
      )
        throw new AccessError('invalid');
      await requirePlayBrowserContext(transaction, browserContext);
    }
    if (candidate.candidateKind === 'EXISTING') {
      if (!actor || actor.identity.userId !== candidate.candidateUserId)
        throw new AccessError('unauthorized');
      await requireOriginalSottoAdmission(transaction, actor.request, actor.identity);
    } else if (candidate.provisionedUserId) {
      requireOrdinaryPlayEnrollment(await (await sottoAccessStore(transaction)).read(), candidate);
    }
    const room = await loadPlayRoom(transaction, candidate.roomId);
    const now = clock();
    if (
      candidate.generation !== room.invitationGeneration ||
      ['CANCELLED', 'EXPIRED'].includes(room.status) ||
      (room.expiresAt <= now && room.status !== 'COMPLETED') ||
      !['WAITING_FOR_OWNER', 'WAITING_FOR_HOST', 'ACCEPTED', 'CLAIMED'].includes(
        candidate.status
      ) ||
      (candidate.status !== 'CLAIMED' && candidate.expiresAt <= now)
    )
      throw new PlaySafetyError('PLAY_UNAVAILABLE', 'Join request unavailable.');
    const participants = playAdmissionParticipants(room, candidate);
    await lockPlaySafetyParticipants(transaction, participants);
    await requirePlayInteractionAllowed(transaction, participants, false);
    if (candidate.acceptedConductVersion !== PLAY_CONDUCT_VERSION) {
      await transaction.playJoinRequest.update({
        where: { id: requestId },
        data: { acceptedConductVersion: command.version, acceptedConductAt: now },
      });
    }
    const userId = candidate.candidateUserId ?? candidate.provisionedUserId;
    if (userId) {
      await transaction.playSafetyState.updateMany({
        where: {
          userId,
          OR: [{ conductVersion: null }, { conductVersion: { not: command.version } }],
        },
        data: { conductVersion: command.version, acceptedAt: now, revision: { increment: 1 } },
      });
    }
    return { requestId, version: command.version };
  });
}

export function readPlayEntryStatus(
  database: PrismaClient,
  requestId: string,
  proof: unknown,
  clock: PlayClock = () => new Date()
) {
  const proofHash = playProofHash(proof);
  return sottoTransaction(database, async (transaction) =>
    projectPlayJoinStatus(
      transaction,
      await requirePlayClaimant(transaction, requestId, proofHash),
      clock()
    )
  );
}
