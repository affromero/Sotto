import {
  playResourceIdSchema,
  playSafetyCompletedSchema,
  reportPlayContentSchema,
} from '@sotto/shared';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  requirePlayActor,
} from '@/lib/play/http';
import { reportPlayContent } from '@/lib/play/safety/reports';

export function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    const id = playResourceIdSchema.parse((await context.params).roomId);
    await limitPlayOperation(`safety-report:${actor.identity.userId}`, 5);
    return playJson(
      playSafetyCompletedSchema,
      await reportPlayContent(actor, id, await playBody(request, reportPlayContentSchema)),
      201
    );
  });
}
