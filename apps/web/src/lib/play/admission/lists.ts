import { AccessError } from 'thesidedoor-core/access';
import type { PlayPendingRequestView } from '@sotto/shared';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { PlayActor, PlayClock } from '../storage/rooms';
import { loadPlayRoom } from '../storage/room-view';
import { projectPendingPlayRequest } from './views';
import { lockPlaySafetyParticipants, playAdmissionParticipants } from '../safety/fences';

/** A host sees only their room; server owners separately see pending enrollments. */
export function listPendingPlayRequests(
  actor: PlayActor,
  roomId: string | null,
  clock: PlayClock = () => new Date()
) {
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    const now = clock();
    if (roomId) {
      const room = await loadPlayRoom(database, roomId);
      if (room.hostUserId !== actor.identity.userId) throw new AccessError('forbidden');
    } else if (!actor.identity.isOwner) throw new AccessError('forbidden');
    const candidates = await database.playJoinRequest.findMany({
      where: {
        ...(roomId ? { roomId } : { candidateKind: 'NEW', provisionedUserId: null }),
        status: { in: ['WAITING_FOR_OWNER', 'WAITING_FOR_HOST', 'ACCEPTED'] },
        expiresAt: { gt: now },
        room: { status: 'WAITING', expiresAt: { gt: now }, guestUserId: null },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    const views: PlayPendingRequestView[] = [];
    const rooms = await database.playRoom.findMany({
      where: { id: { in: candidates.map((candidate) => candidate.roomId) } },
    });
    await lockPlaySafetyParticipants(
      database,
      candidates.flatMap((candidate) => {
        const room = rooms.find((item) => item.id === candidate.roomId)!;
        return playAdmissionParticipants(room, candidate);
      })
    );
    for (const candidate of candidates)
      views.push(await projectPendingPlayRequest(database, candidate, actor.identity, now));
    return { requests: views.filter((view) => !['REVOKED', 'EXPIRED'].includes(view.status)) };
  });
}
