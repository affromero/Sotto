import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { matchesLearningSpeechFingerprint } from '@/lib/learning/speech-configuration';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { assertSelectedLearningAudio } from '@/lib/learning-map/evidence/audio';
import { learningAudioIdentitySchema } from '@/lib/learning-map/evidence/media-protocol';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { authoredSectionSchema } from '../generation/assessment-authoring';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import {
  requireAssessmentSettlementWork,
  requirePendingAssessmentWork,
} from '../generation/assessment-work';
import { stageAssessmentSection } from '../generation/assessment-draft';
import { requireAssessmentReviewCapacity } from '../review/assessment-review-capacity';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const lineageSchema = z
  .object({
    version: z.literal(1),
    identity: z.object({ id: z.uuid(), fingerprint: sha }).strict(),
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    assessmentId: z.string().min(1),
    episodeId: z.string().min(1),
    episodeCreatedAt: z.number().int().nonnegative(),
    generationKey: z.string().min(1),
    scriptHash: sha,
    speechFingerprint: sha,
    reviewDigest: sha.optional(),
    ownership: z.json(),
    storage: z.json(),
    ttsProvider: z.string().min(1),
    ttsModel: z.string().min(1),
    voices: z
      .array(
        z
          .object({
            speaker: z.string().min(1),
            provider: z.string().min(1),
            voiceId: z.string().min(1),
          })
          .strict()
      )
      .min(1),
  })
  .strict();
type Lineage = z.infer<typeof lineageSchema>;

function lineageId(episodeId: string) {
  const key = createHash('sha256').update(episodeId).digest('hex');
  return `${SIDEDOOR_STATE_ID}:assessment-audio:${key}`;
}

function backend(database: Prisma.TransactionClient, episodeId: string) {
  return sqlStateBackend(
    { query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
    'postgres',
    lineageId(episodeId)
  );
}

/** Inspect the completed lineage without reopening its generation authority. */
export async function inspectAssessmentAudioLineageForDeletion(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    courseId: string;
    userId: string;
    assessmentId: string;
    episodeId: string;
    identity: { id: string; fingerprint: string };
    ownership: Awaited<ReturnType<typeof capturePrerequisiteOwnership>>;
  }
) {
  const id = lineageId(input.episodeId);
  const row = await database.sidedoorState.findUnique({ where: { id } });
  if (!row) throw new AssessmentFenceConflict();
  const lineage = lineageSchema.parse(row.state);
  const episode = await database.episode.findUnique({
    where: { id: input.episodeId },
    include: { script: true, voices: { orderBy: { speaker: 'asc' } } },
  });
  const storage = await captureEpisodeStorage(database, input.episodeId);
  const capturedStorage = z
    .object({
      scopes: z.array(
        z.object({
          subjectId: z.string(),
          generation: z.number(),
        })
      ),
    })
    .passthrough()
    .parse(lineage.storage);
  if (
    !episode ||
    !episode.script ||
    lineage.classId !== input.classId ||
    lineage.courseId !== input.courseId ||
    lineage.userId !== input.userId ||
    lineage.assessmentId !== input.assessmentId ||
    lineage.episodeId !== input.episodeId ||
    !isDeepStrictEqual(lineage.identity, input.identity) ||
    !isDeepStrictEqual(lineage.ownership, input.ownership) ||
    !isDeepStrictEqual(capturedStorage.scopes, storage.scopes) ||
    episode.userId !== input.userId ||
    episode.createdAt.getTime() !== lineage.episodeCreatedAt ||
    episode.audioGenerationKey !== lineage.generationKey ||
    episode.assessmentAudioAssessmentId !== input.assessmentId ||
    episode.assessmentAudioOperationId !== input.identity.id ||
    episode.status !== 'READY' ||
    episode.deletedAt !== null ||
    episode.source !== 'CLASS' ||
    episode.visibility !== 'PRIVATE' ||
    episode.script.soundCues !== null ||
    !lineage.reviewDigest ||
    episode.ttsProvider !== lineage.ttsProvider ||
    episode.ttsModel !== lineage.ttsModel ||
    learningScriptHash(episode.script.turns) !== lineage.scriptHash ||
    !isDeepStrictEqual(
      episode.voices.map(({ speaker, provider, voiceId }) => ({ speaker, provider, voiceId })),
      lineage.voices
    )
  )
    throw new AssessmentFenceConflict();
  return {
    id,
    revision: row.revision,
    generationKey: lineage.generationKey,
    storage,
    originalStorage: lineage.storage,
    provider: lineage.ttsProvider,
    model: lineage.ttsModel,
    voices: lineage.voices,
  };
}

async function verify(
  database: Prisma.TransactionClient,
  lineage: Lineage,
  execution: SottoProviderExecution,
  allowEmptySegments = false
) {
  const { current } = await requirePendingAssessmentWork(
    database,
    lineage.identity,
    execution,
    'RUNNING'
  );
  if (
    current.classId !== lineage.classId ||
    current.courseId !== lineage.courseId ||
    current.userId !== lineage.userId ||
    current.assessmentId !== lineage.assessmentId ||
    !isDeepStrictEqual(current.ownership, lineage.ownership)
  )
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${lineage.assessmentId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${lineage.episodeId} FOR UPDATE`;
  const section = await database.classAssessmentSection.findUniqueOrThrow({
    where: { assessmentId_skill: { assessmentId: lineage.assessmentId, skill: 'LISTENING' } },
    include: { episode: { include: { script: true, voices: { orderBy: { speaker: 'asc' } } } } },
  });
  const draft = authoredSectionSchema.parse(section.authoredDraft);
  const episode = section.episode;
  if (
    draft.skill !== 'LISTENING' ||
    !episode ||
    !episode.script ||
    episode.id !== lineage.episodeId ||
    episode.userId !== lineage.userId ||
    episode.deletedAt !== null ||
    episode.visibility !== 'PRIVATE' ||
    episode.source !== 'CLASS' ||
    episode.createdAt.getTime() !== lineage.episodeCreatedAt ||
    episode.assessmentAudioAssessmentId !== lineage.assessmentId ||
    episode.assessmentAudioSectionId !== section.id ||
    episode.assessmentAudioOperationId !== lineage.identity.id ||
    section.audioReservationEpisodeId !== episode.id ||
    section.audioReservationOperationId !== lineage.identity.id ||
    episode.audioGenerationKey !== lineage.generationKey ||
    !['GENERATING_AUDIO', 'STITCHING', 'READY'].includes(episode.status) ||
    episode.language !== current.requirements.targetLang ||
    episode.ttsProvider !== current.requirements.ttsProvider ||
    episode.ttsProvider !== lineage.ttsProvider ||
    episode.ttsModel !== lineage.ttsModel ||
    episode.script.soundCues !== null ||
    learningScriptHash(episode.script.turns) !== lineage.scriptHash ||
    !isDeepStrictEqual(
      episode.voices.map(({ speaker, provider, voiceId }) => ({ speaker, provider, voiceId })),
      lineage.voices
    ) ||
    !isDeepStrictEqual(await captureEpisodeStorage(database, episode.id), lineage.storage)
  )
    throw new AssessmentFenceConflict();
  const segments = await database.segment.findMany({
    where: { episodeId: episode.id },
    orderBy: { order: 'asc' },
    select: {
      order: true,
      speaker: true,
      text: true,
      ttsProvider: true,
      ttsModel: true,
      ttsVoiceId: true,
    },
  });
  if (
    !(allowEmptySegments && segments.length === 0) &&
    (segments.length !== draft.turns.length ||
      segments.some(
        (segment, index) =>
          segment.order !== index ||
          segment.speaker !== draft.turns[index]?.speaker ||
          segment.text !== draft.turns[index]?.text ||
          segment.ttsProvider !== null ||
          segment.ttsModel !== null ||
          segment.ttsVoiceId !== null
      ))
  )
    throw new AssessmentFenceConflict();
  await stageAssessmentSection(database, lineage.identity, execution, draft);
  if (
    !lineage.reviewDigest ||
    (await requireAssessmentReviewCapacity(database, lineage.identity, execution)) !==
      lineage.reviewDigest
  )
    throw new AssessmentFenceConflict();
  if (
    !(await matchesLearningSpeechFingerprint(
      database,
      execution.authorize,
      current.requirements,
      lineage.speechFingerprint,
      execution.signal
    ))
  )
    throw new AssessmentFenceConflict();
  return lineage;
}

/** Called inside the transaction that creates segments and their outbox records. */
export async function registerAssessmentAudioLineage(
  database: Prisma.TransactionClient,
  input: {
    identity: { id: string; fingerprint: string };
    execution: SottoProviderExecution;
    episodeId: string;
    generationKey: string;
    speechFingerprint: string;
  }
) {
  const { current } = await requirePendingAssessmentWork(
    database,
    input.identity,
    input.execution,
    'RUNNING'
  );
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${current.assessmentId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${input.episodeId} FOR UPDATE`;
  const episode = await database.episode.findUniqueOrThrow({
    where: { id: input.episodeId },
    include: {
      script: true,
      voices: { orderBy: { speaker: 'asc' } },
    },
  });
  if (!episode.script) throw new AssessmentFenceConflict();
  const lineage = lineageSchema.parse({
    version: 1,
    identity: input.identity,
    classId: current.classId,
    courseId: current.courseId,
    userId: current.userId,
    assessmentId: current.assessmentId,
    episodeId: episode.id,
    episodeCreatedAt: episode.createdAt.getTime(),
    generationKey: input.generationKey,
    scriptHash: learningScriptHash(episode.script.turns),
    speechFingerprint: input.speechFingerprint,
    reviewDigest: await requireAssessmentReviewCapacity(database, input.identity, input.execution),
    ownership: current.ownership,
    storage: await captureEpisodeStorage(database, episode.id),
    ttsProvider: episode.ttsProvider,
    ttsModel: episode.ttsModel,
    voices: episode.voices.map(({ speaker, provider, voiceId }) => ({
      speaker,
      provider,
      voiceId,
    })),
  });
  const speakers = new Set(
    z
      .array(z.object({ speaker: z.string() }))
      .parse(episode.script.turns)
      .map((turn) => turn.speaker)
  );
  if (
    speakers.size !== lineage.voices.length ||
    lineage.voices.some(
      (voice) => !speakers.has(voice.speaker) || voice.provider !== lineage.ttsProvider
    )
  )
    throw new AssessmentFenceConflict();
  await verify(database, lineage, input.execution, true);
  const store = backend(database, input.episodeId);
  const previous = await store.read();
  if (previous) {
    if (!isDeepStrictEqual(lineageSchema.parse(previous.state), lineage))
      throw new AssessmentFenceConflict();
  } else if (!(await store.compareAndSwap(null, { revision: randomUUID(), state: lineage })))
    throw new AssessmentFenceConflict();
  return lineage;
}

/** Child audio and stitching must validate the original owner, teaching, script and speech selection. */
export async function validateAssessmentAudioLineage(
  database: Prisma.TransactionClient,
  episodeId: string,
  generationKey: string
) {
  const stored = await backend(database, episodeId).read();
  if (!stored) throw new AssessmentFenceConflict();
  const lineage = lineageSchema.parse(stored.state);
  if (lineage.episodeId !== episodeId || lineage.generationKey !== generationKey)
    throw new AssessmentFenceConflict();
  const execution: SottoProviderExecution = {
    userId: lineage.userId,
    authorize: async (tx) => {
      const ownership = await capturePrerequisiteOwnership(
        tx,
        lineage.classId,
        lineage.courseId,
        lineage.userId
      );
      if (!isDeepStrictEqual(ownership, lineage.ownership)) throw new AssessmentFenceConflict();
      return { userId: lineage.userId };
    },
  };
  await verify(database, lineage, execution);
}

/** Bind retained audio to its original parent without requiring the source or grant to remain valid. */
export async function readAssessmentAudioSettlementLineage(
  database: Prisma.TransactionClient,
  episodeId: string,
  generationKey: string
) {
  const stored = await backend(database, episodeId).read();
  if (!stored) throw new AssessmentFenceConflict();
  const lineage = lineageSchema.parse(stored.state);
  if (lineage.episodeId !== episodeId || lineage.generationKey !== generationKey)
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${lineage.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${lineage.assessmentId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} FOR UPDATE`;
  const locked = await backend(database, episodeId).read();
  if (
    !locked ||
    locked.revision !== stored.revision ||
    !isDeepStrictEqual(locked.state, stored.state)
  )
    throw new AssessmentFenceConflict();
  const { current } = await requireAssessmentSettlementWork(database, lineage.identity);
  const ownership = await capturePrerequisiteOwnership(
    database,
    lineage.classId,
    lineage.courseId,
    lineage.userId
  );
  const section = await database.classAssessmentSection.findUnique({
    where: { assessmentId_skill: { assessmentId: lineage.assessmentId, skill: 'LISTENING' } },
    include: { episode: true },
  });
  const episode = section?.episode;
  if (
    current.classId !== lineage.classId ||
    current.courseId !== lineage.courseId ||
    current.userId !== lineage.userId ||
    current.assessmentId !== lineage.assessmentId ||
    !isDeepStrictEqual(current.ownership, lineage.ownership) ||
    !isDeepStrictEqual(ownership, lineage.ownership) ||
    !section ||
    !episode ||
    section.episodeId !== episodeId ||
    section.audioReservationEpisodeId !== episodeId ||
    section.audioReservationOperationId !== lineage.identity.id ||
    episode.userId !== lineage.userId ||
    episode.createdAt.getTime() !== lineage.episodeCreatedAt ||
    episode.assessmentAudioAssessmentId !== lineage.assessmentId ||
    episode.assessmentAudioSectionId !== section.id ||
    episode.assessmentAudioOperationId !== lineage.identity.id ||
    episode.audioGenerationKey !== generationKey
  )
    throw new AssessmentFenceConflict();
  return { lineage, current };
}

/** Bind the canonical stitched bytes to their reserved private assessment in the READY transaction. */
export async function bindAssessmentAudioIdentity(
  database: Prisma.TransactionClient,
  input: unknown
) {
  const identity = learningAudioIdentitySchema.parse(input);
  await validateAssessmentAudioLineage(database, identity.episodeId, identity.audioGenerationKey);
  await assertSelectedLearningAudio(database, identity);
  const section = await database.classAssessmentSection.findUnique({
    where: { episodeId: identity.episodeId },
    include: { assessment: true },
  });
  if (
    !section ||
    section.skill !== 'LISTENING' ||
    section.assessment.userId !== identity.userId ||
    section.audioReservationEpisodeId !== identity.episodeId ||
    section.audioReservationOperationId !== section.assessment.generationOperationId ||
    (section.audioIdentity !== null && !isDeepStrictEqual(section.audioIdentity, identity))
  )
    throw new AssessmentFenceConflict();
  if (section.audioIdentity === null)
    await database.classAssessmentSection.update({
      where: { id: section.id },
      data: { audioIdentity: identity },
    });
}
