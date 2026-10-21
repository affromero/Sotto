import { acceptPlayConductSchema, playSafetyCompletedSchema } from '@sotto/shared';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  requirePlayActor,
} from '@/lib/play/http';
import { acceptPlayConduct } from '@/lib/play/safety/preferences';

export function POST(request: Request) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`safety-preference:${actor.identity.userId}`, 30);
    return playJson(
      playSafetyCompletedSchema,
      await acceptPlayConduct(actor, await playBody(request, acceptPlayConductSchema))
    );
  });
}
