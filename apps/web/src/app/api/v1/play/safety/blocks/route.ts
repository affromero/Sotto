import { playBlockListSchema, playPageQuerySchema } from '@sotto/shared';
import {
  limitPlayOperation,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';
import { listPlayBlocks } from '@/lib/play/safety/preferences';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`safety-read:${actor.identity.userId}`, 180);
    return playJson(
      playBlockListSchema,
      await listPlayBlocks(actor, playQuery(request, playPageQuerySchema))
    );
  });
}
