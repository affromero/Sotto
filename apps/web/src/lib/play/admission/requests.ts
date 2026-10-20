import { AccessError, tokenHash } from 'thesidedoor-core/access';
import { playClaimantProofSchema, requestPlayJoinSchema } from '@sotto/shared';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { PlayRuleError } from '../errors';
import { playFingerprint } from '../storage/fingerprint';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { projectPlayJoinStatus } from './views';

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
  clock: PlayClock = () => new Date()
) {
  const command = requestPlayJoinSchema.parse(input);
  const proofHash = playProofHash(proof);
  const candidateUserId = command.candidate.kind === 'EXISTING' ? actor?.identity.userId : null;
  if (command.candidate.kind === 'EXISTING' && !actor) throw new AccessError('unauthorized');
  const fingerprint = playFingerprint({ command, candidateUserId, proofHash });
  const operation = () =>
    sottoTransaction(database, async (transaction) => {
      const now = clock();
      if (command.candidate.kind === 'EXISTING' && actor)
        await requireOriginalSottoAdmission(transaction, actor.request, actor.identity);
      const previous = await transaction.playJoinRequest.findUnique({
        where: { id: command.requestId },
      });
      if (previous) {
        if (previous.proofHash !== proofHash) throw new AccessError('unauthorized');
        if (previous.fingerprint !== fingerprint)
          throw new PlayRuleError('conflict', 'That join request ID has already been used.');
        return projectPlayJoinStatus(transaction, previous, now);
      }
      const room = await transaction.playRoom.findUnique({
        where: { invitationHash: tokenHash(command.code) },
      });
      if (!room || room.status !== 'WAITING' || room.expiresAt <= now || room.guestUserId)
        throw new AccessError('forbidden', 'Invitation unavailable.');
      if (room.hostUserId === candidateUserId)
        throw new PlayRuleError('conflict', 'You already host this game.');
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
      if (command.candidate.kind === 'EXISTING' && actor)
        await requireOriginalSottoAdmission(transaction, actor.request, actor.identity);
      const previous = await transaction.playJoinRequest.findUnique({
        where: { id: command.requestId },
      });
      if (!previous)
        throw new PlayRuleError('conflict', 'Use a fresh proof for each join request.');
      if (previous.proofHash !== proofHash) throw new AccessError('unauthorized');
      if (previous.fingerprint !== fingerprint)
        throw new PlayRuleError('conflict', 'That join request ID has already been used.');
      return projectPlayJoinStatus(transaction, previous, now);
    });
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
