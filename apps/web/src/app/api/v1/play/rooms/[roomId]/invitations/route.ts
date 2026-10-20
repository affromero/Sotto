import {
  playEmptyQuerySchema,
  playInvitationActionSchema,
  playInvitationViewSchema,
  playResourceIdSchema,
} from '@sotto/shared';
import { readPlayInvitation, rotatePlayInvitation } from '@/lib/play/admission/invitations';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    playQuery(request, playEmptyQuerySchema);
    await limitPlayOperation(`read:${actor.identity.userId}`, 180);
    const roomId = playResourceIdSchema.parse((await context.params).roomId);
    return playJson(playInvitationViewSchema.nullable(), await readPlayInvitation(actor, roomId));
  });
}

export function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`invite:${actor.identity.userId}`, 20);
    const roomId = playResourceIdSchema.parse((await context.params).roomId);
    return playJson(
      playInvitationViewSchema,
      await rotatePlayInvitation(actor, roomId, await playBody(request, playInvitationActionSchema))
    );
  });
}
