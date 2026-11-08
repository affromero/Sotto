import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { classRequirementsOrLegacy, readSkillRequirements } from '../../skill-requirements';

type Ownership = Awaited<ReturnType<typeof capturePrerequisiteOwnership>>;

/** Reserve only. Provider admission and publication must separately fence this binding. */
export async function reserveAssessmentListeningEpisode(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  expected: {
    classId: string;
    assessmentId: string;
    classAttempt: number;
    assessmentAttempt: number;
    generationOperationId: string;
    ownership: Ownership;
  }
) {
  execution.signal?.throwIfAborted();
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId || actor.userId !== expected.ownership.userId)
    throw new Error('Assessment learner changed.');
  await database.$queryRaw`SELECT c.id FROM "CourseClass" c JOIN "Course" o ON o.id = c."courseId" WHERE c.id = ${expected.classId} AND o."userId" = ${actor.userId} FOR UPDATE OF c`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${expected.assessmentId} AND "classId" = ${expected.classId} AND "userId" = ${actor.userId} FOR UPDATE`;
  const cls = await database.courseClass.findFirst({
    where: { id: expected.classId, course: { userId: actor.userId } },
    include: { course: true, lesson: true },
  });
  const assessment = await database.classAssessment.findUnique({
    where: { id: expected.assessmentId },
    include: { sections: { where: { skill: 'LISTENING' } } },
  });
  if (
    !cls ||
    !assessment ||
    assessment.classId !== cls.id ||
    assessment.courseId !== cls.courseId ||
    assessment.userId !== actor.userId ||
    cls.attempt !== expected.classAttempt ||
    assessment.classAttempt !== expected.classAttempt ||
    assessment.assessmentAttempt !== expected.assessmentAttempt ||
    !expected.generationOperationId ||
    assessment.generationOperationId !== expected.generationOperationId ||
    assessment.status !== 'GENERATING' ||
    assessment.sealedAt !== null ||
    !['GENERATING', 'AVAILABLE', 'IN_PROGRESS'].includes(cls.status)
  )
    throw new Error('Assessment class or generation changed.');
  const ownership = await capturePrerequisiteOwnership(
    database,
    cls.id,
    cls.courseId,
    actor.userId
  );
  if (!isDeepStrictEqual(ownership, expected.ownership))
    throw new Error('Assessment ownership changed.');
  const requirements = classRequirementsOrLegacy(cls.skillRequirements, {
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    level: cls.lesson.level,
  });
  if (
    requirements.scope !== 'CLASS' ||
    requirements.skills.LISTENING.state !== 'REQUIRED' ||
    !isDeepStrictEqual(requirements, readSkillRequirements(assessment.requirements))
  )
    throw new Error('Assessment listening requirements changed.');
  const section = assessment.sections[0];
  if (!section || assessment.sections.length !== 1)
    throw new Error('Assessment listening section is unavailable.');

  let episodeId = section.episodeId;
  if (!episodeId) {
    if (
      section.audioReservationEpisodeId ||
      section.audioReservationOperationId ||
      section.audioIdentity
    )
      throw new Error('Assessment listening reservation changed.');
    const episode = await database.episode.create({
      data: {
        userId: actor.userId,
        title: 'Assessment audio',
        topic: 'Assessment audio',
        language: cls.course.targetLang,
        source: 'CLASS',
        visibility: 'PRIVATE',
        assessmentAudioAssessmentId: assessment.id,
        assessmentAudioSectionId: section.id,
        assessmentAudioOperationId: expected.generationOperationId,
      },
    });
    episodeId = episode.id;
    await database.classAssessmentSection.update({
      where: { id: section.id },
      data: {
        episodeId,
        audioReservationEpisodeId: episodeId,
        audioReservationOperationId: expected.generationOperationId,
      },
    });
  } else if (
    section.audioReservationEpisodeId !== episodeId ||
    section.audioReservationOperationId !== expected.generationOperationId
  ) {
    throw new Error('Assessment listening reservation changed.');
  }

  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} FOR UPDATE`;
  const episode = await database.episode.findUnique({ where: { id: episodeId } });
  if (
    !episode ||
    episode.userId !== actor.userId ||
    episode.deletedAt ||
    episode.visibility !== 'PRIVATE' ||
    episode.source !== 'CLASS' ||
    episode.language !== requirements.targetLang ||
    episode.assessmentAudioAssessmentId !== assessment.id ||
    episode.assessmentAudioSectionId !== section.id ||
    episode.assessmentAudioOperationId !== expected.generationOperationId
  )
    throw new Error('Assessment listening media is unavailable.');
  const storage = await captureEpisodeStorage(database, episodeId);
  if (
    storage.associations.assessmentSection?.id !== section.id ||
    storage.associations.classSection ||
    storage.associations.examSection ||
    storage.associations.practiceSession
  )
    throw new Error('Assessment listening media is already used by another activity.');
  execution.signal?.throwIfAborted();
  return { episodeId, storage };
}
