import { playReportReviewListSchema, playReportReviewQuerySchema } from '@sotto/shared';
import {
  limitPlayOperation,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';
import { listReviewPlayReports } from '@/lib/play/safety/review';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`safety-owner:${actor.identity.userId}`, 30);
    return playJson(
      playReportReviewListSchema,
      await listReviewPlayReports(actor, playQuery(request, playReportReviewQuerySchema))
    );
  });
}
