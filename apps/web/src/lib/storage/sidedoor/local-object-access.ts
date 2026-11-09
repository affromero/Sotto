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
  if (model === 'Episode' || model === 'Segment' || model === 'EpisodeVersion') {
    const parent =
      model === 'Episode'
        ? { episodeId: id }
        : model === 'Segment'
          ? await database.segment.findUnique({ where: { id }, select: { episodeId: true } })
          : await database.episodeVersion.findUnique({
              where: { id },
              select: { episodeId: true },
            });
    if (!parent) return false;
    await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${parent.episodeId} FOR UPDATE`;
    if (model === 'Segment')
      await database.$queryRaw`SELECT id FROM "Segment" WHERE id = ${id} AND "episodeId" = ${parent.episodeId} FOR UPDATE`;
    if (model === 'EpisodeVersion')
      await database.$queryRaw`SELECT id FROM "EpisodeVersion" WHERE id = ${id} AND "episodeId" = ${parent.episodeId} FOR UPDATE`;
    if ((await readStorageConsumerReference(database, consumer)) !== reference) return false;
    return Boolean(
      await database.episode.findFirst({
        where: {
          id: parent.episodeId,
          deletedAt: null,
          assessmentSection: { is: null },
          assessmentAudioAssessmentId: null,
          OR: [{ userId }, { visibility: 'UNLISTED' }],
        },
        select: { id: true },
      })
    );
  }
  if ((await readStorageConsumerReference(database, consumer)) !== reference) return false;
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
              { section: { withdrawn: false, class: { course: { userId } } } },
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
    case 'User':
      return Boolean(await database.user.findUnique({ where: { id }, select: { id: true } }));
    default:
      return false;
  }
}
