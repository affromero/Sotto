import {
  playResourceIdSchema,
  playSafetyCompletedSchema,
  playSafetyMutationSchema,
} from '@sotto/shared';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  requirePlayActor,
} from '@/lib/play/http';
import { blockPlayPartner } from '@/lib/play/safety/preferences';

export function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    const id = playResourceIdSchema.parse((await context.params).roomId);
    await limitPlayOperation(`safety-preference:${actor.identity.userId}`, 30);
    return playJson(
      playSafetyCompletedSchema,
      await blockPlayPartner(actor, id, await playBody(request, playSafetyMutationSchema))
    );
  });
}
