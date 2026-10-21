import {
  playResourceIdSchema,
  playSafetyCompletedSchema,
  reviewPlayReportSchema,
} from '@sotto/shared';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  requirePlayActor,
} from '@/lib/play/http';
import { reviewPlayReport } from '@/lib/play/safety/review';

export function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    const id = playResourceIdSchema.parse((await context.params).reportId);
    await limitPlayOperation(`safety-owner:${actor.identity.userId}`, 30);
    return playJson(
      playSafetyCompletedSchema,
      await reviewPlayReport(actor, id, await playBody(request, reviewPlayReportSchema))
    );
  });
}
