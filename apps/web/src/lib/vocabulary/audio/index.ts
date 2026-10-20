import { prismaUnfiltered as prisma } from '../../prisma';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import { createQueue } from '../../queue';
import {
  admitDurableQueueBatch,
  durableQueueOperationId,
} from '../../sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox } from '../../sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '../../sidedoor/jobs/core/job-execution-lifetime';
import { captureCourseStorage } from '../../sidedoor/storage/core/course-storage';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import type { LearningDatabase } from '../../learning/database';
import { resolveVocabularyAudio } from './provider';
import {
  assertVocabularyStudyOwner,
  vocabularyStudyStateSchema,
  VocabularyStudyNotFound,
  VocabularyStudyUnavailable,
} from '../study-state';

export type VocabularyAudioSubject =
  { wordId: string; courseId: string } | { sessionId: string; cardId: string };

export async function vocabularyAudioSubject(
  database: LearningDatabase,
  userId: string,
  subject: VocabularyAudioSubject
) {
  if ('wordId' in subject) {
    const word = await database.learnerVocab.findFirst({
      where: { id: subject.wordId, courseId: subject.courseId, course: { userId } },
      select: { lemma: true, courseId: true },
    });
    if (!word) throw new VocabularyStudyNotFound('Word not found.');
    return { courseId: word.courseId, text: word.lemma };
  }
  const session = await database.practiceSession.findFirst({
    where: { id: subject.sessionId, course: { userId } },
  });
  if (!session?.vocabularyStudy) throw new VocabularyStudyNotFound('Study not found.');
  const state = vocabularyStudyStateSchema.parse(session.vocabularyStudy);
  assertVocabularyStudyOwner(state, session, userId);
  const card = state.cards.find((item) => item.id === subject.cardId);
  if (!card) throw new VocabularyStudyNotFound('Card not found.');
  if (state.mode === 'WORD_RECALL' && !card.response)
    throw new VocabularyStudyUnavailable('Check your answer before hearing the target word.');
  return { courseId: session.courseId, text: card.lemma };
}

export async function requestVocabularyAudio(
  subject: VocabularyAudioSubject,
  execution: SottoProviderExecution,
  retry = false
) {
  const source = await sottoTransaction(prisma, async (database) => {
    const actor = await execution.authorize(database);
    if (actor.userId !== execution.userId) throw new VocabularyStudyNotFound('Word not found.');
    return vocabularyAudioSubject(database, actor.userId, subject);
  });
  const selected = await resolveVocabularyAudio(source.courseId, source.text, execution);
  let assetId = '';
  await admitDurableQueueBatch({
    authorize: execution.authorize,
    prepare: async (database) => {
      const current = await vocabularyAudioSubject(database, execution.userId, subject);
      if (current.courseId !== source.courseId || current.text !== source.text)
        throw new VocabularyStudyUnavailable('The dictionary word changed.');
      const owner = await captureCourseStorage(database, source.courseId);
      if (owner.userId !== execution.userId) throw new VocabularyStudyNotFound('Word not found.');
      await database.vocabularyPronunciation.createMany({
        data: {
          courseId: source.courseId,
          fingerprint: selected.fingerprint,
          text: source.text,
          language: selected.language,
        },
        skipDuplicates: true,
      });
      let asset = await database.vocabularyPronunciation.findUniqueOrThrow({
        where: {
          courseId_fingerprint: { courseId: source.courseId, fingerprint: selected.fingerprint },
        },
      });
      assetId = asset.id;
      const operationId = durableQueueOperationId(
        'vocabulary-audio',
        `${asset.id}-${asset.generation}`
      );
      const receipt = await sottoJobOutbox(database).read(operationId);
      if (asset.status === 'RUNNING' && receipt) {
        const blocker = await sottoJobExecutions(database).blockingStatus(
          operationId,
          receipt.fingerprint
        );
        if (blocker === 'cleanup-unconfirmed' || Date.now() - asset.updatedAt.getTime() > 30_000)
          asset = await database.vocabularyPronunciation.update({
            where: { id: asset.id },
            data: {
              status: 'UNRESOLVED',
              error:
                'Local pronunciation was interrupted. Confirm worker execution cleanup before retrying.',
            },
          });
      }
      if (retry && ['FAILED', 'UNRESOLVED'].includes(asset.status) && receipt) {
        try {
          await sottoJobExecutions(database).requireParentDrained(operationId, receipt.fingerprint);
        } catch {
          throw new VocabularyStudyUnavailable(
            'Worker execution cleanup must be confirmed before retrying local pronunciation.'
          );
        }
      }
      if (retry && ['FAILED', 'UNRESOLVED'].includes(asset.status))
        asset = await database.vocabularyPronunciation.update({
          where: { id: asset.id },
          data: { generation: { increment: 1 }, status: 'QUEUED', error: null },
        });
      if (['READY', 'FAILED', 'UNRESOLVED', 'RUNNING'].includes(asset.status)) return [];
      return [
        {
          queue: createQueue('vocabulary-audio'),
          type: 'vocabulary-audio',
          payload: { userId: execution.userId, assetId: asset.id, generation: asset.generation },
          jobId: `${asset.id}-${asset.generation}`,
          attempts: 1,
        },
      ];
    },
  });
  const asset = await prisma.vocabularyPronunciation.findUniqueOrThrow({ where: { id: assetId } });
  return { status: asset.status, error: asset.error };
}
