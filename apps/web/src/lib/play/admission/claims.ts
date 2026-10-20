import { randomUUID } from 'node:crypto';
import { AccessError, AccessService, isAccessError } from 'thesidedoor-core/access';
import { playDeliverySchema, playMemberSchema, type PlayDelivery } from '@sotto/shared';
import { Prisma, type PlayJoinRequest, type PrismaClient } from '@/generated/prisma/client';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { issueSottoPairing, redeemSottoPairing } from '@/lib/sidedoor/access/core/pairing';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { PlayRuleError } from '../errors';
import { playFingerprint } from '../storage/fingerprint';
import { loadPlayRoom, playHostWaiting, type StoredPlayRoom } from '../storage/room-view';
import type { PlayActor, PlayClock } from '../storage/rooms';
import {
  requireOrdinaryPlayEnrollment,
  requirePlayBrowserContext,
  type PlayBrowserContext,
} from './authority';
import {
  openPlayDelivery,
  sealPlayDelivery,
  type PlayDeliveryBinding,
  type PlayDeliveryEnvelope,
} from './delivery-receipt';
import { playProofHash, requirePlayClaimant } from './requests';

const DELIVERY_TTL_MS = 10 * 60 * 1000;
type PlayClaimResult = { delivery: PlayDelivery; browserSessionToken: string | null };

async function deliveryBinding(
  database: Prisma.TransactionClient,
  candidate: PlayJoinRequest
): Promise<PlayDeliveryBinding> {
  if (!candidate.provisionedUserId || !candidate.deliveryId) throw new AccessError('forbidden');
  return {
    version: 1,
    instanceId: (await sottoStorageInstance(database).read()).instanceId,
    roomId: candidate.roomId,
    requestId: candidate.id,
    profileId: candidate.provisionedUserId,
    deliveryId: candidate.deliveryId,
    claimantProofHash: candidate.proofHash,
    enrollmentGeneration: candidate.enrollmentGeneration,
  };
}

async function existingMember(
  database: Prisma.TransactionClient,
  candidate: PlayJoinRequest,
  actor: PlayActor | null
) {
  if (!actor || actor.identity.userId !== candidate.candidateUserId)
    throw new AccessError('unauthorized');
  await requireOriginalSottoAdmission(database, actor.request, actor.identity);
  return actor.identity.userId;
}

function requireLiveAdmission(candidate: PlayJoinRequest, room: StoredPlayRoom, now: Date) {
  if (
    candidate.generation !== room.invitationGeneration ||
    ['CANCELLED', 'EXPIRED'].includes(room.status) ||
    (room.expiresAt <= now && room.status !== 'COMPLETED')
  )
    throw new PlayRuleError('conflict', 'This admission is no longer available.');
}

async function recoverNewDelivery(
  database: Prisma.TransactionClient,
  candidate: PlayJoinRequest,
  room: StoredPlayRoom,
  clock: PlayClock
): Promise<PlayClaimResult | null> {
  const now = clock();
  if (
    candidate.acknowledgedAt ||
    !candidate.deliveryState ||
    !candidate.deliveryExpiresAt ||
    candidate.deliveryExpiresAt <= now
  ) {
    await database.playJoinRequest.update({
      where: { id: candidate.id },
      data: { deliveryState: Prisma.DbNull },
    });
    return null;
  }
  const access = new AccessService({
    store: await sottoAccessStore(database),
    now: () => clock().getTime(),
  });
  try {
    requireLiveAdmission(candidate, room, now);
    requireOrdinaryPlayEnrollment(await access.store.read(), candidate);
    if (room.guestUserId !== candidate.provisionedUserId) throw new AccessError('forbidden');
    const envelope = openPlayDelivery(
      await deliveryBinding(database, candidate),
      candidate.deliveryState
    );
    const response = envelope.response;
    if (response.kind !== candidate.client) throw new AccessError('forbidden');
    if (response.kind === 'BROWSER') {
      const credential = await access.authenticate(envelope.browserSessionToken!);
      if (
        credential.principal?.id !== candidate.provisionedUserId ||
        credential.principal.role !== 'member' ||
        credential.session.id !== envelope.credentialId ||
        new Date(credential.session.expiresAt).toISOString() !== response.expiresAt
      )
        throw new AccessError('forbidden');
    } else {
      const credential = await sottoDeviceService(access).authenticate(response.token, ['app']);
      if (
        credential.principal?.id !== candidate.provisionedUserId ||
        credential.principal.role !== 'member' ||
        credential.id !== envelope.credentialId ||
        credential.scopes.length !== 1 ||
        credential.scopes[0] !== 'app' ||
        credential.defaultProfileId !== undefined ||
        credential.expiresAt === null ||
        new Date(credential.expiresAt).toISOString() !== response.expiresAt
      )
        throw new AccessError('forbidden');
    }
    return { delivery: response, browserSessionToken: envelope.browserSessionToken };
  } catch (error) {
    if (
      !(error instanceof PlayRuleError) &&
      !(isAccessError(error) && ['forbidden', 'unauthorized', 'invalid'].includes(error.code))
    )
      throw error;
    await database.playJoinRequest.update({
      where: { id: candidate.id },
      data: { deliveryState: Prisma.DbNull },
    });
    return null;
  }
}

/** A committed delivery replays independently of the initial waiting/slot/lease checks. */
export async function claimPlayEntry(
  database: PrismaClient,
  requestId: string,
  proof: unknown,
  actor: PlayActor | null,
  clock: PlayClock = () => new Date(),
  browserContext?: PlayBrowserContext
): Promise<PlayClaimResult> {
  const proofHash = playProofHash(proof),
    deliveryId = randomUUID();
  const result = await sottoTransaction(
    database,
    async (transaction): Promise<PlayClaimResult | null> => {
      const candidate = await requirePlayClaimant(transaction, requestId, proofHash);
      if (candidate.client === 'BROWSER')
        await requirePlayBrowserContext(transaction, browserContext);
      const room = await loadPlayRoom(transaction, candidate.roomId);
      const now = clock();
      if (candidate.status === 'CLAIMED' && candidate.candidateKind === 'NEW')
        return recoverNewDelivery(transaction, candidate, room, clock);
      requireLiveAdmission(candidate, room, now);
      const memberId =
        candidate.candidateKind === 'EXISTING'
          ? await existingMember(transaction, candidate, actor)
          : requireOrdinaryPlayEnrollment(
              await (await sottoAccessStore(transaction)).read(),
              candidate
            ).id;
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: memberId },
        select: { name: true },
      });
      const profile = playMemberSchema.parse({
        id: memberId,
        name: user.name ?? 'Player',
        settings: candidate.settings,
      });
      const existingFingerprint = playFingerprint({
        requestId,
        roomId: room.id,
        memberId,
        proofHash,
      });
      if (candidate.status === 'CLAIMED') {
        if (room.guestUserId !== memberId) throw new AccessError('forbidden');
        const receipt = await transaction.playActionReceipt.findUnique({
          where: { actorUserId_actionId: { actorUserId: memberId, actionId: requestId } },
        });
        if (
          !receipt ||
          receipt.operation !== 'CLAIM' ||
          receipt.fingerprint !== existingFingerprint
        )
          throw new AccessError('forbidden');
        const delivery = playDeliverySchema.parse(receipt.result);
        if (
          delivery.kind !== 'EXISTING' ||
          delivery.roomId !== room.id ||
          delivery.profile.id !== memberId
        )
          throw new AccessError('forbidden');
        return { delivery, browserSessionToken: null };
      }
      if (
        candidate.candidateKind === 'EXISTING' &&
        (await transaction.playActionReceipt.findUnique({
          where: { actorUserId_actionId: { actorUserId: memberId, actionId: requestId } },
          select: { actionId: true },
        }))
      )
        throw new PlayRuleError('conflict', 'That action ID has already been used.');
      if (
        candidate.status !== 'ACCEPTED' ||
        candidate.expiresAt <= now ||
        room.status !== 'WAITING' ||
        room.guestUserId ||
        !room.invitationHash
      )
        throw new PlayRuleError('conflict', 'Wait for the host to accept this request.');
      if (!(await playHostWaiting(transaction, room.id, clock())))
        throw new PlayRuleError('conflict', 'The host must return to the waiting game.');
      const admitted = await transaction.playRoom.updateMany({
        where: { id: room.id, revision: room.revision, status: 'WAITING', guestUserId: null },
        data: {
          guestUserId: memberId,
          guestSettings: profile.settings,
          revision: { increment: 1 },
        },
      });
      if (admitted.count !== 1) throw new PlayRuleError('conflict', 'The game changed. Try again.');
      if (candidate.candidateKind === 'EXISTING') {
        const delivery = playDeliverySchema.parse({ kind: 'EXISTING', roomId: room.id, profile });
        await transaction.playJoinRequest.update({
          where: { id: requestId },
          data: { status: 'CLAIMED' },
        });
        await transaction.playActionReceipt.create({
          data: {
            roomId: room.id,
            actorUserId: memberId,
            actionId: requestId,
            operation: 'CLAIM',
            fingerprint: existingFingerprint,
            revision: room.revision + 1,
            result: delivery,
          },
        });
        return { delivery, browserSessionToken: null };
      }
      // Canonical access mutations start only after the complete host fence is checked.
      const access = new AccessService({
        store: await sottoAccessStore(transaction),
        now: () => clock().getTime(),
      });
      const sessionToken = await access.store.transact((state) =>
        access.issueSession(state, memberId, candidate.deviceName)
      );
      let envelope: PlayDeliveryEnvelope;
      if (candidate.client === 'NATIVE') {
        const pairing = await issueSottoPairing(transaction, sessionToken, candidate.deviceName, {
          scopes: ['app'],
        });
        const redeemed = await redeemSottoPairing(transaction, pairing.token);
        const device = await sottoDeviceService(access).authenticate(redeemed.token, ['app']);
        if (
          device.principal?.id !== memberId ||
          device.scopes.length !== 1 ||
          device.scopes[0] !== 'app' ||
          device.defaultProfileId !== undefined ||
          device.expiresAt === null
        )
          throw new AccessError('forbidden');
        await access.logout(sessionToken);
        envelope = {
          version: 1,
          browserSessionToken: null,
          credentialId: device.id,
          response: {
            kind: 'NATIVE',
            deliveryId,
            roomId: room.id,
            profile,
            token: redeemed.token,
            expiresAt: new Date(device.expiresAt).toISOString(),
          },
        };
      } else {
        const session = await access.authenticate(sessionToken);
        envelope = {
          version: 1,
          browserSessionToken: sessionToken,
          credentialId: session.session.id,
          response: {
            kind: 'BROWSER',
            deliveryId,
            roomId: room.id,
            profile,
            expiresAt: new Date(session.session.expiresAt).toISOString(),
          },
        };
      }
      const binding: PlayDeliveryBinding = {
        version: 1,
        instanceId: (await sottoStorageInstance(transaction).read()).instanceId,
        roomId: room.id,
        requestId,
        profileId: memberId,
        deliveryId,
        claimantProofHash: proofHash,
        enrollmentGeneration: candidate.enrollmentGeneration,
      };
      const state = sealPlayDelivery(binding, envelope);
      await transaction.playJoinRequest.update({
        where: { id: requestId },
        data: {
          status: 'CLAIMED',
          deliveryId,
          deliveryState: state,
          deliveryExpiresAt: new Date(
            Math.min(
              now.getTime() + DELIVERY_TTL_MS,
              new Date(envelope.response.expiresAt).getTime()
            )
          ),
        },
      });
      return { delivery: envelope.response, browserSessionToken: envelope.browserSessionToken };
    }
  );
  if (!result) throw new AccessError('unauthorized', 'Delivery is no longer available.');
  return result;
}

export function acknowledgePlayDelivery(
  database: PrismaClient,
  requestId: string,
  proof: unknown,
  deliveryId: string,
  clock: PlayClock = () => new Date()
) {
  const proofHash = playProofHash(proof);
  return sottoTransaction(database, async (transaction) => {
    const candidate = await requirePlayClaimant(transaction, requestId, proofHash);
    if (
      candidate.status !== 'CLAIMED' ||
      candidate.deliveryId !== deliveryId ||
      candidate.candidateKind !== 'NEW'
    )
      throw new AccessError('forbidden');
    if (!candidate.acknowledgedAt)
      await transaction.playJoinRequest.update({
        where: { id: requestId },
        data: { acknowledgedAt: clock(), deliveryState: Prisma.DbNull },
      });
    return { acknowledged: true };
  });
}
