import { AccessError, AccessService, tokenHash } from 'thesidedoor-core/access';
import { cookieValue } from 'thesidedoor-core/access/http';
import { PLAY_HOST_LEASE_MS, playPresenceInputSchema, playPresenceViewSchema } from '@sotto/shared';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { PlayRuleError } from '../errors';
import { playFingerprint } from '../storage/fingerprint';
import { loadPlayRoom, playHostWaiting } from '../storage/room-view';
import type { PlayActor, PlayClock } from '../storage/rooms';

const MAX_ROOM_VIEWS = 8;

/** A foreground view has its own lease, fenced by canonical access state and hard expiry. */
export function updatePlayPresence(
  actor: PlayActor,
  roomId: string,
  input: unknown,
  clock: PlayClock = () => new Date()
) {
  const command = playPresenceInputSchema.parse(input);
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    const room = await loadPlayRoom(database, roomId);
    const now = clock();
    if (room.hostUserId !== actor.identity.userId)
      throw new PlayRuleError('forbidden', 'Only the host can wait for players.');
    const binding = {
      roomId,
      credentialKind: actor.identity.authentication,
      credentialId:
        actor.identity.authentication === 'device'
          ? actor.identity.deviceId
          : actor.identity.sessionId,
      viewHash: tokenHash(command.viewNonce),
    };
    if (room.status !== 'WAITING' || room.expiresAt <= now) {
      if (command.type === 'RENEW')
        throw new PlayRuleError('conflict', 'The host is no longer in a waiting game.');
      await database.playPresenceLease.deleteMany({ where: binding });
      return playPresenceViewSchema.parse({
        hostWaiting: false,
        expiresAt: null,
        serverTime: now.toISOString(),
      });
    }
    const access = new AccessService({
      store: await sottoAccessStore(database),
      now: () => clock().getTime(),
    });
    const credentialDeadline =
      actor.identity.authentication === 'device'
        ? (
            await sottoDeviceService(access).authenticate(
              actor.request.headers.get('authorization')!.slice(7),
              ['app']
            )
          ).expiresAt
        : (await access.authenticate(cookieValue(actor.request, SHARED_SESSION_COOKIE)!)).session
            .expiresAt;
    const hardExpiry = new Date(credentialDeadline ?? room.expiresAt.getTime());
    const expiresAt = new Date(
      Math.min(now.getTime() + PLAY_HOST_LEASE_MS, hardExpiry.getTime(), room.expiresAt.getTime())
    );
    const lease = {
      ...binding,
      accessFingerprint: playFingerprint(await access.store.read()),
      credentialExpiresAt: hardExpiry,
      renewedAt: now,
      expiresAt,
    };
    if (command.type === 'RELEASE') {
      const released = { ...lease, releasedAt: now, expiresAt: now };
      await database.playPresenceLease.upsert({
        where: { roomId_credentialKind_credentialId_viewHash: binding },
        create: released,
        update: released,
      });
      return playPresenceViewSchema.parse({
        hostWaiting: await playHostWaiting(database, roomId, now),
        expiresAt: null,
        serverTime: now.toISOString(),
      });
    }
    // Retain released nonces until the room ends. Expired active leases can be renewed.
    await database.playPresenceLease.deleteMany({
      where: { roomId, releasedAt: null, expiresAt: { lte: now } },
    });
    const previous = await database.playPresenceLease.findUnique({
      where: { roomId_credentialKind_credentialId_viewHash: binding },
      select: { id: true, releasedAt: true },
    });
    if (previous?.releasedAt)
      throw new PlayRuleError('conflict', 'This view left the game. Open a fresh game view.');
    if (
      !previous &&
      (await database.playPresenceLease.count({ where: { roomId, releasedAt: null } })) >=
        MAX_ROOM_VIEWS
    )
      throw new AccessError('rate_limited', 'Close another game view before opening one.');
    if (!previous)
      await database.playPresenceLease.createMany({ data: [lease], skipDuplicates: true });
    const renewed = await database.playPresenceLease.updateMany({
      where: { ...binding, releasedAt: null },
      data: lease,
    });
    if (renewed.count !== 1)
      throw new PlayRuleError('conflict', 'This view left the game. Open a fresh game view.');
    return playPresenceViewSchema.parse({
      hostWaiting: true,
      expiresAt: expiresAt.toISOString(),
      serverTime: now.toISOString(),
    });
  });
}
