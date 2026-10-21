import { playActionRequestSchema, playResourceIdSchema, playRoomViewSchema } from '@sotto/shared';
import { actOnStoredPlayRoom } from '@/lib/play/storage/rooms';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  requirePlayActor,
} from '@/lib/play/http';

export function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`write:${actor.identity.userId}`, 120);
    const roomId = playResourceIdSchema.parse((await context.params).roomId);
    return playJson(
      playRoomViewSchema,
      await actOnStoredPlayRoom(actor, roomId, await playBody(request, playActionRequestSchema))
    );
  });
}
