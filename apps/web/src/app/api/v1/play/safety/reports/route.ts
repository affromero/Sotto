import { playPageQuerySchema, playReportListSchema } from '@sotto/shared';
import {
  limitPlayOperation,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';
import { listOwnPlayReports } from '@/lib/play/safety/reports';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`safety-read:${actor.identity.userId}`, 180);
    return playJson(
      playReportListSchema,
      await listOwnPlayReports(actor, playQuery(request, playPageQuerySchema))
    );
  });
}
