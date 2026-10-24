import type { Prisma } from '@/generated/prisma/client';
import {
  parseStorageConsumer,
  readStorageConsumerReference,
} from '@/lib/sidedoor/storage/core/storage-consumers';

/** Application access and the live reference must be checked in the attribution transaction. */
export async function canReadLocalObjectConsumer(
  database: Prisma.TransactionClient,
  userId: string,
  reference: string,
  consumer: string
): Promise<boolean> {
  let parsed: ReturnType<typeof parseStorageConsumer>;
  try {
    parsed = parseStorageConsumer(consumer);
  } catch {
    return false;
  }
  const { model, id } = parsed;
  if (model === 'CourseMaterial' || model === 'MaterialUploadPart') return false;
  if ((await readStorageConsumerReference(database, consumer)) !== reference) return false;

  const episode: Prisma.EpisodeWhereInput = {
    deletedAt: null,
    OR: [{ userId }, { visibility: 'UNLISTED' }],
  };
  switch (model) {
    case 'CourseClass':
      return Boolean(
        await database.courseClass.findFirst({
          where: { id, course: { userId } },
          select: { id: true },
        })
      );
    case 'SpeakingRecording':
      return Boolean(
        await database.speakingRecording.findFirst({
          where: { id, userId },
          select: { id: true },
        })
      );
    case 'SpeakingPrompt': {
      const prompt = await database.speakingPrompt.findUnique({
        where: { id },
        select: { sectionId: true, practiceSessionId: true, examSectionId: true },
      });
      if (
        !prompt ||
        [prompt.sectionId, prompt.practiceSessionId, prompt.examSectionId].filter(Boolean)
          .length !== 1
      )
        return false;
      return Boolean(
        await database.speakingPrompt.findFirst({
          where: {
            id,
            OR: [
              { section: { class: { course: { userId } } } },
              { practiceSession: { course: { userId } } },
              { examSection: { exam: { userId } } },
            ],
          },
          select: { id: true },
        })
      );
    }
    case 'LearnerFocusTarget':
      return Boolean(
        await database.learnerFocusTarget.findFirst({
          where: { id, course: { userId } },
          select: { id: true },
        })
      );
    case 'VocabularyPronunciation':
      return Boolean(
        await database.vocabularyPronunciation.findFirst({
          where: { id, course: { userId } },
          select: { id: true },
        })
      );
    case 'Episode':
      return Boolean(
        await database.episode.findFirst({
          where: { id, ...episode },
          select: { id: true },
        })
      );
    case 'Segment':
      return Boolean(
        await database.segment.findFirst({
          where: { id, episode },
          select: { id: true },
        })
      );
    case 'EpisodeVersion':
      return Boolean(
        await database.episodeVersion.findFirst({
          where: { id, episode },
          select: { id: true },
        })
      );
    case 'User':
      return Boolean(await database.user.findUnique({ where: { id }, select: { id: true } }));
    default:
      return false;
  }
}
