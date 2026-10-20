import {
  acknowledgePlayDeliverySchema,
  playAcknowledgedSchema,
  playResourceIdSchema,
} from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { acknowledgePlayDelivery } from '@/lib/play/admission/claims';
import {
  PLAY_PROOF_HEADER,
  limitPlayOperation,
  playBody,
  playBrowserMutation,
  playJson,
  playOperation,
} from '@/lib/play/http';

export function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return playOperation(request, playBrowserMutation(request), async () => {
    await limitPlayOperation('ack:instance', 60);
    const requestId = playResourceIdSchema.parse((await context.params).requestId);
    const command = await playBody(request, acknowledgePlayDeliverySchema);
    return playJson(
      playAcknowledgedSchema,
      await acknowledgePlayDelivery(
        prismaUnfiltered,
        requestId,
        request.headers.get(PLAY_PROOF_HEADER),
        command.deliveryId
      )
    );
  });
}
