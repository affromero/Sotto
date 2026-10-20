import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { learningScriptHash, learningScriptTranscript } from '@/lib/learning/script-hash';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import {
  objectiveTaskFingerprint,
  pendingListeningAssessmentSchema,
  reviewedObjectiveAssessmentSchema,
} from './protocol';
import { learningAudioIdentitySchema, type LearningAudioIdentity } from './media-protocol';

/** Called only from the canonical writer's READY commit, after the asset registry binds its consumer. */
export async function publishLearningAudioIdentity(
  database: Prisma.TransactionClient,
  input: {
    episodeId: string;
    audioUrl: string;
    contentSha256: string;
    contentBytes: number;
    version: number;
  }
) {
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: input.episodeId },
    include: { script: true },
  });
  // Non-learning or legacy imports may have no captured script/generation. They confer no listening evidence.
  if (!episode.script || !episode.audioGenerationKey) return null;
  if (
    episode.status !== 'READY' ||
    episode.audioUrl !== input.audioUrl ||
    episode.currentVersion !== input.version
  )
    throw new Error('Audio evidence requires the exact canonical READY publication.');
  const reference = (
    await resolveStorageInput(database, {
      consumer: `episode:${episode.id}:audio`,
      reference: input.audioUrl,
    })
  ).input;
  const identity = learningAudioIdentitySchema.parse({
    schemaVersion: 1,
    episodeId: episode.id,
    userId: episode.userId,
    scriptSha256: learningScriptHash(episode.script.turns),
    contentSha256: input.contentSha256,
    contentBytes: input.contentBytes,
    audioGenerationKey: episode.audioGenerationKey,
    version: input.version,
    reference,
  });
  await database.$executeRaw`UPDATE "Episode" SET "learningAudioIdentity" = ${JSON.stringify(identity)}::jsonb WHERE id = ${episode.id}`;
  const seal = (value: unknown, courseId: string) => {
    if (value === null || value === undefined) return value;
    if (reviewedObjectiveAssessmentSchema.safeParse(value).success) return value;
    const pending = pendingListeningAssessmentSchema.parse(value);
    if (
      pending.scope.userId !== episode.userId ||
      pending.scope.courseId !== courseId ||
      pending.scriptSha256 !== identity.scriptSha256 ||
      pending.task.passageText !== learningScriptTranscript(episode.script!.turns)
    )
      throw new Error('Listening question attribution changed its selected script or owner.');
    const task = {
      ...pending.task,
      audio: { scriptSha256: identity.scriptSha256, contentSha256: identity.contentSha256 },
    };
    return reviewedObjectiveAssessmentSchema.parse({
      schemaVersion: 1,
      scope: pending.scope,
      criterion: pending.criterion,
      task,
      taskFingerprint: objectiveTaskFingerprint(pending.scope.targetLang, pending.criterion, task),
      media: identity,
      review: pending.review,
    });
  };
  const sections = await database.classSection.findMany({
    where: { episodeId: episode.id, skill: 'LISTENING' },
    include: { questions: true },
  });
  for (const section of sections) {
    const cls = await database.courseClass.findUniqueOrThrow({
      where: { id: section.classId },
      select: { courseId: true },
    });
    for (const question of section.questions) {
      const assessment = seal(question.learningAssessment, cls.courseId);
      if (assessment !== question.learningAssessment)
        await database.lessonQuestion.update({
          where: { id: question.id },
          data: { learningAssessment: assessment as Prisma.InputJsonValue },
        });
    }
  }
  const sessions = await database.practiceSession.findMany({ where: { episodeId: episode.id } });
  for (const session of sessions) {
    if (!Array.isArray(session.items))
      throw new Error('Listening practice lost its stored item inventory.');
    let changed = false;
    const items = session.items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error('Listening practice item has invalid structure.');
      if (!('learningAssessment' in item) || !item.learningAssessment) return item;
      const assessment = seal(item.learningAssessment, session.courseId);
      changed ||= assessment !== item.learningAssessment;
      return { ...item, learningAssessment: assessment };
    });
    if (changed)
      await database.practiceSession.update({
        where: { id: session.id },
        data: { items: items as Prisma.InputJsonValue },
      });
  }
  return identity;
}

/** A regenerated or relocated asset cannot lend its current READY state to an older selected task. */
export async function assertSelectedLearningAudio(
  database: Prisma.TransactionClient,
  input: LearningAudioIdentity
) {
  const expected = learningAudioIdentitySchema.parse(input);
  const episode = await database.episode.findUnique({
    where: { id: expected.episodeId },
    include: { script: true },
  });
  const rows = await database.$queryRaw<
    Array<{ learningAudioIdentity: unknown }>
  >`SELECT "learningAudioIdentity" FROM "Episode" WHERE id = ${expected.episodeId}`;
  const current = learningAudioIdentitySchema.parse(rows[0]?.learningAudioIdentity);
  if (
    !episode ||
    episode.deletedAt ||
    episode.status !== 'READY' ||
    episode.userId !== expected.userId ||
    episode.audioUrl !== expected.reference.reference ||
    episode.currentVersion !== expected.version ||
    episode.audioGenerationKey !== expected.audioGenerationKey ||
    !episode.script ||
    learningScriptHash(episode.script.turns) !== expected.scriptSha256 ||
    !isDeepStrictEqual(current, expected)
  )
    throw new Error('The exact selected listening audio or generation changed.');
  const resolved = await resolveStorageInput(database, expected.reference);
  if (!isDeepStrictEqual(resolved.input, expected.reference))
    throw new Error('The selected listening asset attribution changed.');
  return expected;
}
