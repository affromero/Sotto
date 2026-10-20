import { playDeliverySchema, playEmptyQuerySchema, playResourceIdSchema } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { claimPlayEntry } from '@/lib/play/admission/claims';
import { playProofHash, requirePlayClaimant } from '@/lib/play/admission/requests';
import {
  PLAY_PROOF_HEADER,
  limitPlayOperation,
  optionalPlayActor,
  playBody,
  playBrowserMutation,
  playJson,
  playOperation,
  setPlayBrowserSession,
} from '@/lib/play/http';

export function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return playOperation(request, playBrowserMutation(request), async () => {
    await limitPlayOperation('claim:instance', 60);
    await playBody(request, playEmptyQuerySchema);
    const requestId = playResourceIdSchema.parse((await context.params).requestId);
    const proof = request.headers.get(PLAY_PROOF_HEADER);
    const proofHash = playProofHash(proof);
    const client = await sottoTransaction(
      prismaUnfiltered,
      async (database) => (await requirePlayClaimant(database, requestId, proofHash)).client
    );
    return playOperation(request, client === 'BROWSER', async () => {
      const actor = await optionalPlayActor(request);
      const result = await claimPlayEntry(prismaUnfiltered, requestId, proof, actor);
      const response = playJson(playDeliverySchema, result.delivery);
      if (result.delivery.kind === 'BROWSER' && result.browserSessionToken)
        setPlayBrowserSession(
          response,
          result.browserSessionToken,
          result.delivery.expiresAt,
          request
        );
      return response;
    });
  });
}
