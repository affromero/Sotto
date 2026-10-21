import { playEmptyQuerySchema, playPendingRequestListSchema } from '@sotto/shared';
import { listPendingPlayRequests } from '@/lib/play/admission/lists';
import {
  limitPlayOperation,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    playQuery(request, playEmptyQuerySchema);
    await limitPlayOperation(`read:${actor.identity.userId}`, 180);
    return playJson(playPendingRequestListSchema, await listPendingPlayRequests(actor, null));
  });
}
