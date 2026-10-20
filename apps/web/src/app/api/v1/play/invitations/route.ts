import { NextResponse } from 'next/server';
import {
  playInvitationPreviewSchema,
  playInvitationQuerySchema,
  playJoinStatusViewSchema,
  requestPlayJoinSchema,
} from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { previewPlayInvitation } from '@/lib/play/admission/invitations';
import { requestPlayEntry } from '@/lib/play/admission/requests';
import {
  PLAY_PROOF_HEADER,
  limitPlayOperation,
  optionalPlayActor,
  playBody,
  playBrowserMutation,
  playJson,
  playOperation,
  playQuery,
} from '@/lib/play/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return playOperation(request, false, async () => {
    await limitPlayOperation('preview:instance', 120);
    const { code } = playQuery(request, playInvitationQuerySchema);
    const preview = await previewPlayInvitation(prismaUnfiltered, code);
    if (!preview) return NextResponse.json({ error: 'Invitation unavailable.' }, { status: 404 });
    return playJson(playInvitationPreviewSchema, preview);
  });
}

export function POST(request: Request) {
  return playOperation(request, playBrowserMutation(request), async () => {
    await limitPlayOperation('intake:instance', 30);
    const command = await playBody(request, requestPlayJoinSchema);
    return playOperation(request, command.client === 'BROWSER', async () => {
      const browserNew = command.client === 'BROWSER' && command.candidate.kind === 'NEW';
      // Explicit anonymous enrollment uses no authority from an unselected cookie.
      const actor =
        browserNew && !request.headers.has('authorization')
          ? null
          : await optionalPlayActor(request);
      return playJson(
        playJoinStatusViewSchema,
        await requestPlayEntry(
          prismaUnfiltered,
          command,
          request.headers.get(PLAY_PROOF_HEADER),
          actor,
          undefined,
          browserNew ? { request, expectedProfileId: null } : undefined
        ),
        201
      );
    });
  });
}
