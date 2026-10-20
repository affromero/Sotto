import {
  playPageQuerySchema,
  playPhraseListSchema,
  playPhraseViewSchema,
  savePlayPhraseSchema,
} from '@sotto/shared';
import { listStoredPlayPhrases, saveStoredPlayPhrase } from '@/lib/play/storage/phrases';
import {
  limitPlayOperation,
  playBody,
  playJson,
  playOperation,
  playQuery,
  requirePlayActor,
} from '@/lib/play/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return playOperation(request, false, async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`read:${actor.identity.userId}`, 180);
    return playJson(
      playPhraseListSchema,
      await listStoredPlayPhrases(actor, playQuery(request, playPageQuerySchema))
    );
  });
}

export function POST(request: Request) {
  return playOperation(request, !request.headers.has('authorization'), async () => {
    const actor = await requirePlayActor(request);
    await limitPlayOperation(`write:${actor.identity.userId}`, 120);
    const { roomId, ...phrase } = await playBody(request, savePlayPhraseSchema);
    return playJson(playPhraseViewSchema, await saveStoredPlayPhrase(actor, roomId, phrase), 201);
  });
}
