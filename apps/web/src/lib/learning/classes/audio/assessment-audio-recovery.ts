import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { learningAudioIdentitySchema } from '@/lib/learning-map/evidence/media-protocol';
import { learningScriptHash } from '@/lib/learning/script-hash';
import {
  matchesPublishedStorageIdentity,
  resolvePublishedStorageReference,
} from '@/lib/sidedoor/storage/migration/storage-publication';

/** Recheck a completed private stitch without requiring its generation grant to remain active. */
export async function verifyAssessmentAudioRecovery(
  database: Prisma.TransactionClient,
  expected: {
    episodeId: string;
    userId: string;
    generationKey: string;
    audioUrl: string;
    version: number;
    stitchKey: string;
    association: {
      id: string;
      assessmentId: string;
      classId: string;
      classAttempt: number;
      currentClassAttempt: number;
      assessmentAttempt: number;
    };
    allowHistoricalAttempt?: boolean;
    signal?: AbortSignal;
  }
) {
  const { association } = expected;
  expected.signal?.throwIfAborted();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${association.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${association.assessmentId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${expected.episodeId} FOR UPDATE`;
  const section = await database.classAssessmentSection.findUnique({
    where: { id: association.id },
    include: { assessment: { include: { class: true } }, episode: { include: { script: true } } },
  });
  const episode = section?.episode;
  const assessment = section?.assessment;
  if (
    !section ||
    !assessment ||
    !episode ||
    !episode.script ||
    !episode.audioUrl ||
    section.skill !== 'LISTENING' ||
    section.episodeId !== expected.episodeId ||
    section.assessmentId !== association.assessmentId ||
    assessment.classId !== association.classId ||
    assessment.userId !== expected.userId ||
    assessment.classAttempt !== association.classAttempt ||
    assessment.assessmentAttempt !== association.assessmentAttempt ||
    (assessment.class.attempt !== association.currentClassAttempt &&
      (!expected.allowHistoricalAttempt ||
        assessment.status !== 'COMMITTED' ||
        association.currentClassAttempt !== association.classAttempt ||
        assessment.class.attempt < association.currentClassAttempt)) ||
    section.audioReservationEpisodeId !== expected.episodeId ||
    section.audioReservationOperationId !== assessment.generationOperationId ||
    episode.userId !== expected.userId ||
    episode.deletedAt !== null ||
    episode.status !== 'READY' ||
    episode.assessmentAudioAssessmentId !== association.assessmentId ||
    episode.assessmentAudioSectionId !== association.id ||
    episode.assessmentAudioOperationId !== assessment.generationOperationId ||
    episode.audioGenerationKey !== expected.generationKey ||
    episode.currentVersion !== expected.version ||
    episode.lastCompletedStitchKey !== expected.stitchKey
  )
    throw new Error('Assessment audio recovery binding changed');
  const identity = learningAudioIdentitySchema.parse(section.audioIdentity);
  const rows = await database.$queryRaw<Array<{ learningAudioIdentity: unknown }>>`
    SELECT "learningAudioIdentity" FROM "Episode" WHERE id = ${expected.episodeId}`;
  if (
    !isDeepStrictEqual(
      identity,
      learningAudioIdentitySchema.parse(rows[0]?.learningAudioIdentity)
    ) ||
    identity.episodeId !== expected.episodeId ||
    identity.userId !== expected.userId ||
    identity.audioGenerationKey !== expected.generationKey ||
    identity.version !== expected.version ||
    identity.scriptSha256 !== learningScriptHash(episode.script.turns) ||
    identity.reference.consumer !== `episode:${expected.episodeId}:audio` ||
    identity.reference.reference !== expected.audioUrl
  )
    throw new Error('Assessment audio recovery identity changed');
  const proof = await resolvePublishedStorageReference(database, {
    consumer: identity.reference.consumer,
    originalReference: identity.reference.reference,
    currentReference: episode.audioUrl,
    signal: expected.signal,
  });
  if (
    !matchesPublishedStorageIdentity(proof, {
      original: identity.reference,
      currentReference: episode.audioUrl,
      contentSha256: identity.contentSha256,
      contentBytes: identity.contentBytes,
    })
  )
    throw new Error('Assessment audio recovery storage changed');
  expected.signal?.throwIfAborted();
}
