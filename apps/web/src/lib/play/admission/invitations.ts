import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { tokenHash } from 'thesidedoor-core/access';
import {
  CredentialCodec,
  credentialStateSchema,
  initialCredentialState,
} from 'thesidedoor-core/configuration';
import {
  playInvitationActionSchema,
  playInvitationPreviewSchema,
  playInvitationViewSchema,
  playInviteCodeSchema,
} from '@sotto/shared';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';
import { PlayRuleError } from '../errors';
import { playFingerprint } from '../storage/fingerprint';
import { loadPlayRoom, playHostWaiting } from '../storage/room-view';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { lockPlaySafetyParticipants, requirePlayInteractionAllowed } from '../safety/fences';
import { redactPlayPublishedName } from '../safety/policy';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const inviteReceiptSchema = z.strictObject({
  binding: z.strictObject({
    instanceId: z.uuid(),
    roomId: z.string(),
    actorUserId: z.string(),
    actionId: z.uuid(),
    generation: z.number().int().positive(),
  }),
  state: credentialStateSchema,
  expiresAt: z.iso.datetime(),
});
const inviteDescriptor = {
  id: 'play-invitation',
  label: 'Game invitation',
  transport: 'api' as const,
  capabilities: [],
  models: [],
  fields: [{ id: 'code', label: 'Code', kind: 'string' as const, required: true, secret: true }],
};

function invitationCodec(binding: z.infer<typeof inviteReceiptSchema>['binding']) {
  return new CredentialCodec({
    namespace: `play-invitation:v1:${playFingerprint(binding)}`,
    encryptionKey: deriveOwnedCredentialKey,
    descriptors: () => [inviteDescriptor],
  });
}

async function readInvitationReceipt(
  database: Prisma.TransactionClient,
  actor: PlayActor,
  roomId: string,
  actionId: string,
  fingerprint: string
) {
  const receipt = await database.playActionReceipt.findUnique({
    where: { actorUserId_actionId: { actorUserId: actor.identity.userId, actionId } },
  });
  if (!receipt) return null;
  if (
    receipt.operation !== 'INVITE' ||
    receipt.fingerprint !== fingerprint ||
    receipt.roomId !== roomId
  )
    throw new PlayRuleError('conflict', 'That action ID has already been used.');
  const packet = inviteReceiptSchema.parse(receipt.result);
  const instance = await sottoStorageInstance(database).read();
  if (
    packet.binding.instanceId !== instance.instanceId ||
    packet.binding.roomId !== roomId ||
    packet.binding.actorUserId !== actor.identity.userId ||
    packet.binding.actionId !== actionId
  )
    throw new PlayRuleError('forbidden', 'Invitation unavailable.');
  const code = invitationCodec(packet.binding).resolveState(packet.state, inviteDescriptor.id).code;
  return playInvitationViewSchema.parse({
    roomId,
    code,
    generation: packet.binding.generation,
    expiresAt: packet.expiresAt,
  });
}

async function requireInviteHost(
  database: Prisma.TransactionClient,
  actor: PlayActor,
  roomId: string
) {
  await requireOriginalSottoAdmission(database, actor.request, actor.identity);
  const room = await loadPlayRoom(database, roomId);
  if (room.hostUserId !== actor.identity.userId)
    throw new PlayRuleError('forbidden', 'Only the host can share this game.');
  await lockPlaySafetyParticipants(database, [room.hostUserId, room.guestUserId]);
  await requirePlayInteractionAllowed(database, [room.hostUserId, room.guestUserId]);
  return room;
}

/** Rotation revokes old pending capabilities, including reserved but unclaimed entrants. */
export function rotatePlayInvitation(
  actor: PlayActor,
  roomId: string,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = playInvitationActionSchema.parse(input);
  const code = Array.from({ length: 12 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join(
    ''
  );
  const fingerprint = playFingerprint({ roomId, command });
  const apply = () =>
    sottoTransaction(actor.database, async (database) => {
      const room = await requireInviteHost(database, actor, roomId);
      const now = clock();
      const previous = await readInvitationReceipt(
        database,
        actor,
        roomId,
        command.actionId,
        fingerprint
      );
      if (previous) return previous;
      if (room.status !== 'WAITING' || room.expiresAt <= now || room.guestUserId)
        throw new PlayRuleError('conflict', 'This game cannot invite another player.');
      const updated = await database.playRoom.updateMany({
        where: { id: roomId, revision: command.expectedRevision },
        data: {
          revision: { increment: 1 },
          invitationGeneration: { increment: 1 },
          invitationHash: tokenHash(code),
        },
      });
      if (updated.count !== 1) throw new PlayRuleError('conflict', 'The game changed. Refresh it.');
      await database.playJoinRequest.updateMany({
        where: { roomId },
        data: { status: 'REVOKED', deliveryState: Prisma.DbNull },
      });
      const generation = room.invitationGeneration + 1;
      const binding = {
        instanceId: (await sottoStorageInstance(database).read()).instanceId,
        roomId,
        actorUserId: actor.identity.userId,
        actionId: command.actionId,
        generation,
      };
      const state = initialCredentialState();
      invitationCodec(binding).replaceState(state, inviteDescriptor.id, { code });
      const result = playInvitationViewSchema.parse({
        roomId,
        code,
        generation,
        expiresAt: room.expiresAt.toISOString(),
      });
      await database.playActionReceipt.create({
        data: {
          roomId,
          actorUserId: actor.identity.userId,
          actionId: command.actionId,
          operation: 'INVITE',
          fingerprint,
          revision: room.revision + 1,
          result: { binding, state, expiresAt: result.expiresAt },
        },
      });
      return result;
    });
  return apply().catch(async (error: unknown) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    const previous = await sottoTransaction(actor.database, async (database) => {
      await requireInviteHost(database, actor, roomId);
      return readInvitationReceipt(database, actor, roomId, command.actionId, fingerprint);
    });
    if (!previous) throw error;
    return previous;
  });
}

/** A reconnecting host can recover the current share code without storing plaintext. */
export function readPlayInvitation(
  actor: PlayActor,
  roomId: string,
  clock: PlayClock = () => new Date()
) {
  return sottoTransaction(actor.database, async (database) => {
    const room = await requireInviteHost(database, actor, roomId);
    const now = clock();
    if (
      room.status !== 'WAITING' ||
      room.expiresAt <= now ||
      room.guestUserId ||
      !room.invitationHash
    )
      return null;
    const receipt = await database.playActionReceipt.findFirst({
      where: { roomId, operation: 'INVITE', actorUserId: actor.identity.userId },
      orderBy: { revision: 'desc' },
    });
    if (!receipt) throw new PlayRuleError('invalid', 'The invitation receipt is missing.');
    const result = await readInvitationReceipt(
      database,
      actor,
      roomId,
      receipt.actionId,
      receipt.fingerprint
    );
    if (
      !result ||
      result.generation !== room.invitationGeneration ||
      tokenHash(result.code) !== room.invitationHash
    )
      throw new PlayRuleError('invalid', 'The invitation is inconsistent.');
    return result;
  });
}

/** Opening a link is read-only and reveals no learner ID, settings, or pending candidates. */
export function previewPlayInvitation(
  database: PrismaClient,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const code = playInviteCodeSchema.parse(input);
  return sottoTransaction(database, async (transaction) => {
    const now = clock();
    const room = await transaction.playRoom.findUnique({
      where: { invitationHash: tokenHash(code) },
      include: { host: { select: { name: true } } },
    });
    if (!room || room.status !== 'WAITING' || room.expiresAt <= now || room.guestUserId)
      return null;
    await lockPlaySafetyParticipants(transaction, [room.hostUserId]);
    await requirePlayInteractionAllowed(transaction, [room.hostUserId], false);
    const reserved = await transaction.playJoinRequest.count({
      where: { roomId: room.id, status: { in: ['ACCEPTED', 'CLAIMED'] } },
    });
    if (reserved > 0) return null;
    return playInvitationPreviewSchema.parse({
      roomId: room.id,
      hostName: redactPlayPublishedName(room.host.name, 'Host'),
      kind: room.kind,
      theme: room.theme,
      questionStyle: room.questionStyle,
      hostWaiting: await playHostWaiting(transaction, room.id, now),
      expiresAt: room.expiresAt.toISOString(),
      serverTime: now.toISOString(),
    });
  });
}
