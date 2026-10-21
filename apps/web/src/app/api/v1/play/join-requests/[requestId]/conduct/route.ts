import {
  acceptPendingPlayConductSchema,
  playPendingConductAcceptedSchema,
  playResourceIdSchema,
} from '@sotto/shared';
import { AccessError } from 'thesidedoor-core/access';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  acceptPendingPlayConduct,
  playProofHash,
  requirePlayClaimant,
} from '@/lib/play/admission/requests';
import {
  PLAY_PROOF_HEADER,
  limitPlayOperation,
  optionalPlayActor,
  playBody,
  playBrowserMutation,
  playJson,
  playOperation,
} from '@/lib/play/http';

export function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return playOperation(request, playBrowserMutation(request), async () => {
    await limitPlayOperation('pending-conduct:instance', 60);
    const command = await playBody(request, acceptPendingPlayConductSchema);
    const requestId = playResourceIdSchema.parse((await context.params).requestId);
    const proof = request.headers.get(PLAY_PROOF_HEADER);
    const candidate = await sottoTransaction(prismaUnfiltered, (database) =>
      requirePlayClaimant(database, requestId, playProofHash(proof))
    );
    return playOperation(request, candidate.client === 'BROWSER', async () => {
      if (candidate.client === 'BROWSER' && !('expectedProfileId' in command))
        throw new AccessError('invalid');
      const actor =
        candidate.client === 'BROWSER' &&
        candidate.candidateKind === 'NEW' &&
        !request.headers.has('authorization')
          ? null
          : await optionalPlayActor(request);
      return playJson(
        playPendingConductAcceptedSchema,
        await acceptPendingPlayConduct(
          prismaUnfiltered,
          requestId,
          proof,
          command,
          actor,
          undefined,
          candidate.client === 'BROWSER' && 'expectedProfileId' in command
            ? { request, expectedProfileId: command.expectedProfileId }
            : undefined
        )
      );
    });
  });
}
