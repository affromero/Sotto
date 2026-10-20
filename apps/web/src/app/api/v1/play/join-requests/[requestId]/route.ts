import {
  playEmptyQuerySchema,
  playJoinStatusViewSchema,
  playResourceIdSchema,
} from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { readPlayEntryStatus } from '@/lib/play/admission/requests';
import {
  PLAY_PROOF_HEADER,
  limitPlayOperation,
  playJson,
  playOperation,
  playQuery,
} from '@/lib/play/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return playOperation(request, false, async () => {
    await limitPlayOperation('status:instance', 600);
    playQuery(request, playEmptyQuerySchema);
    const requestId = playResourceIdSchema.parse((await context.params).requestId);
    return playJson(
      playJoinStatusViewSchema,
      await readPlayEntryStatus(prismaUnfiltered, requestId, request.headers.get(PLAY_PROOF_HEADER))
    );
  });
}
