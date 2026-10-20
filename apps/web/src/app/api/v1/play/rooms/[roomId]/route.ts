import { playEmptyQuerySchema, playResourceIdSchema, playRoomViewSchema } from '@sotto/shared';
import { readStoredPlayRoom } from '@/lib/play/storage/rooms';
import {
  limitPlayOperation,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    playQuery(request, playEmptyQuerySchema);
    await limitPlayOperation(`read:${actor.identity.userId}`, 180);
    const roomId = playResourceIdSchema.parse((await context.params).roomId);
    return playJson(playRoomViewSchema, await readStoredPlayRoom(actor, roomId));
  });
}
