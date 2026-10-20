import {
  playPresenceInputSchema,
  playPresenceViewSchema,
  playResourceIdSchema,
} from '@sotto/shared';
import { updatePlayPresence } from '@/lib/play/admission/presence';
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
    await limitPlayOperation(`presence:${actor.identity.userId}`, 120);
    const roomId = playResourceIdSchema.parse((await context.params).roomId);
    return playJson(
      playPresenceViewSchema,
      await updatePlayPresence(actor, roomId, await playBody(request, playPresenceInputSchema))
    );
  });
}
