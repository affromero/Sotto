import {
  approvePlayJoinSchema,
  playPendingRequestViewSchema,
  playResourceIdSchema,
} from '@sotto/shared';
import { approvePlayEntry } from '@/lib/play/admission/approvals';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  requirePlayActor,
} from '@/lib/play/http';

export function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`approval:${actor.identity.userId}`, 60);
    const requestId = playResourceIdSchema.parse((await context.params).requestId);
    return playJson(
      playPendingRequestViewSchema,
      await approvePlayEntry(actor, requestId, await playBody(request, approvePlayJoinSchema))
    );
  });
}
