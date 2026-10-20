import { z } from 'zod';
import { playPhraseInputSchema, playPhraseViewSchema, type PlayRoundView } from '@sotto/shared';
import type { PlayPhrase } from '@/generated/prisma/client';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { PlayRuleError } from '../errors';
import { playFingerprint } from './fingerprint';
import { loadPlayRoom, projectStoredPlayRoom } from './room-view';
import type { PlayActor } from './rooms';

function visiblePhrases(round: PlayRoundView): (string | null)[] {
  const shared = [...round.hints.map((hint) => hint.text), round.result?.correction ?? null];
  if (round.mode === 'DESCRIBE') return [...shared, round.target, round.clue, round.guess];
  if (round.mode === 'MISSION')
    return [...shared, ...round.messages.map((message) => message.text)];
  if (round.questionStyle === 'CHOICES')
    return [...shared, ...round.choices.map((card) => card.text)];
  return [...shared, round.ownAnswer, round.otherAnswer];
}

function phraseView(phrase: PlayPhrase) {
  return playPhraseViewSchema.parse({
    id: phrase.id,
    roomId: phrase.roomId,
    roundId: phrase.roundId,
    kind: phrase.kind,
    text: phrase.text,
    targetLang: phrase.targetLang,
    contextText: phrase.contextText,
    createdAt: phrase.createdAt.toISOString(),
  });
}

/** Save only language content present in this player's personalized round projection. */
export function saveStoredPlayPhrase(
  actor: PlayActor,
  roomId: string,
  input: unknown,
  now = new Date()
) {
  const command = playPhraseInputSchema.parse(input);
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    const room = await projectStoredPlayRoom(
      database,
      await loadPlayRoom(database, roomId),
      actor.identity.userId,
      now
    );
    const round = [room.round, ...room.completedRounds].find(
      (candidate) => candidate?.id === command.roundId
    );
    if (!round || !visiblePhrases(round).some((source) => source?.includes(command.text)))
      throw new PlayRuleError('forbidden', 'Save a phrase visible in your game.');
    const fingerprint = playFingerprint({
      kind: command.kind,
      text: command.text,
      contextText: command.contextText,
    });
    const phrase = await database.playPhrase.upsert({
      where: {
        userId_roundId_fingerprint: {
          userId: actor.identity.userId,
          roundId: command.roundId,
          fingerprint,
        },
      },
      create: {
        ...command,
        userId: actor.identity.userId,
        roomId,
        targetLang: round.targetLang,
        fingerprint,
        createdAt: now,
      },
      update: {},
    });
    return phraseView(phrase);
  });
}

const notebookQuerySchema = z.strictObject({
  beforeId: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export function listStoredPlayPhrases(actor: PlayActor, input: unknown = {}) {
  const query = notebookQuerySchema.parse(input);
  return sottoTransaction(actor.database, async (database) => {
    await requireOriginalSottoAdmission(database, actor.request, actor.identity);
    if (
      query.beforeId &&
      !(await database.playPhrase.findFirst({
        where: { id: query.beforeId, userId: actor.identity.userId },
        select: { id: true },
      }))
    )
      throw new PlayRuleError('forbidden', 'Notebook page unavailable.');
    const phrases = await database.playPhrase.findMany({
      where: { userId: actor.identity.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.beforeId ? { cursor: { id: query.beforeId }, skip: 1 } : {}),
    });
    const page = phrases.slice(0, query.limit);
    return {
      phrases: page.map(phraseView),
      nextCursor: phrases.length > query.limit ? page.at(-1)!.id : null,
    };
  });
}
