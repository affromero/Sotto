import { randomUUID } from 'node:crypto';
import { createSkillRequirements, vocabularyStudyRequestSchema } from '@sotto/shared';
import { prismaUnfiltered as prisma } from '../prisma';
import { getDueItems } from '../knowledge-graph';
import { getVocabularyTargets } from '../learning/vocabulary/targets';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import {
  publicVocabularyStudy,
  recommendedVocabularyMode,
  vocabularyStudyStateSchema,
  VocabularyStudyConflict,
  VocabularyStudyNotFound,
  VocabularyStudyUnavailable,
} from './study-state';

/** Dictionary study requires no model, moderation key, provider request, or generated exercise. */
export async function startVocabularyStudy(
  courseId: string,
  execution: SottoProviderExecution,
  input: unknown
) {
  const request = vocabularyStudyRequestSchema.parse(input);
  const requestedWordIds = [...new Set(request.wordIds ?? [])].sort();
  if (requestedWordIds.length !== (request.wordIds?.length ?? 0))
    throw new VocabularyStudyConflict('Choose each dictionary word once.');
  return sottoTransaction(
    prisma,
    async (database) => {
      const actor = await execution.authorize(database);
      if (actor.userId !== execution.userId) throw new VocabularyStudyNotFound('Course not found.');
      const course = await database.course.findFirst({
        where: { id: courseId, userId: actor.userId },
        select: {
          id: true,
          nativeLang: true,
          targetLang: true,
          currentLevel: true,
          vocabularySupport: true,
          user: { select: { preferredTtsProvider: true } },
        },
      });
      if (!course) throw new VocabularyStudyNotFound('Course not found.');
      await database.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
      const existing = await database.practiceSession.findUnique({
        where: { id: request.requestId },
      });
      if (existing) {
        if (
          existing.courseId !== courseId ||
          existing.kind !== 'VOCAB' ||
          !existing.vocabularyStudy
        )
          throw new VocabularyStudyConflict('This request identity belongs to different practice.');
        const state = vocabularyStudyStateSchema.parse(existing.vocabularyStudy);
        if (
          state.userId !== actor.userId ||
          state.courseId !== courseId ||
          state.requestId !== existing.id ||
          (request.mode && state.mode !== request.mode) ||
          JSON.stringify(state.requestedWordIds) !== JSON.stringify(requestedWordIds)
        )
          throw new VocabularyStudyConflict('This request identity belongs to different study.');
        return publicVocabularyStudy(state, existing);
      }
      if (await database.practiceRequestReceipt.findUnique({ where: { id: request.requestId } }))
        throw new VocabularyStudyConflict('This practice was discarded. Start with a new request.');
      const mode = request.mode ?? recommendedVocabularyMode(course.vocabularySupport);
      if (mode === 'LISTENING_RECALL' && course.user.preferredTtsProvider === 'disabled')
        throw new VocabularyStudyUnavailable(
          'Speech is off. Enable local pronunciation to practice listening.'
        );

      const targets = requestedWordIds.length
        ? []
        : await getVocabularyTargets(
            courseId,
            (await getDueItems(courseId, 8, database)).vocab,
            [],
            8,
            database
          );
      const words = await database.learnerVocab.findMany({
        where: {
          courseId,
          ...(requestedWordIds.length
            ? { id: { in: requestedWordIds } }
            : { lemma: { in: targets.map((target) => target.lemma) } }),
        },
      });
      if (requestedWordIds.length && words.length !== requestedWordIds.length)
        throw new VocabularyStudyNotFound('A selected word is not available in this course.');
      const ordered = requestedWordIds.length
        ? requestedWordIds.flatMap((id) => words.filter((word) => word.id === id))
        : targets.flatMap((target) => words.filter((word) => word.lemma === target.lemma));
      if (!ordered.length)
        throw new VocabularyStudyUnavailable(
          'No words need review. Choose words from your dictionary or import a material.'
        );
      if (ordered.some((word) => !word.translation.trim()))
        throw new VocabularyStudyUnavailable(
          'Add a dictionary meaning to the selected words before studying.'
        );
      const state = vocabularyStudyStateSchema.parse({
        version: 1,
        normalization: 'unicode-v1',
        requestId: request.requestId,
        courseId,
        userId: actor.userId,
        mode,
        support: course.vocabularySupport,
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        requestedWordIds,
        cards: ordered.map((word) => ({
          id: randomUUID(),
          wordId: word.id,
          lemma: word.lemma,
          meaning: word.translation,
          acceptedMeanings: word.acceptedMeanings,
          response: null,
          listeningPresentedAt: null,
        })),
      });
      await database.practiceRequestReceipt.create({ data: { id: request.requestId, courseId } });
      const session = await database.practiceSession.create({
        data: {
          id: request.requestId,
          courseId,
          kind: 'VOCAB',
          status: 'ACTIVE',
          items: [],
          seed: 'dictionary-v1',
          vocabularyStudy: state,
          vocabLemmas: ordered.map((word) => word.lemma),
          skillRequirements: createSkillRequirements({
            scope: 'VOCAB',
            nativeLang: course.nativeLang,
            targetLang: course.targetLang,
            level: course.currentLevel,
            ttsProvider: null,
            sttProvider: null,
          }),
        },
      });
      return publicVocabularyStudy(state, session);
    },
    { signal: execution.signal }
  );
}
