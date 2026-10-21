import {
  createPlayRoomSchema,
  playPageQuerySchema,
  playRoomListSchema,
  playRoomViewSchema,
} from '@sotto/shared';
import { createStoredPlayRoom, listStoredPlayRooms } from '@/lib/play/storage/rooms';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`read:${actor.identity.userId}`, 180);
    return playJson(
      playRoomListSchema,
      await listStoredPlayRooms(actor, playQuery(request, playPageQuerySchema))
    );
  });
}

export function POST(request: Request) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`create:${actor.identity.userId}`, 10);
    return playJson(
      playRoomViewSchema,
      await createStoredPlayRoom(actor, await playBody(request, createPlayRoomSchema)),
      201
    );
  });
}
