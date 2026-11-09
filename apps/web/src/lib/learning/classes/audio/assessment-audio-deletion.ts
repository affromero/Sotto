import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  durableEnvelopeSchema,
  durableQueueOperationId,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  initialStitchAttemptId,
  prepareInitialStitch,
  requireInitialStitchAttempt,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { verifyInitialStitchPublication } from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import { matchesPublishedStorageIdentity } from '@/lib/sidedoor/storage/migration/storage-publication';
import {
  assessmentSpeakingReferenceIdentity,
  assessmentSpeakingReferenceSchema,
} from '../material/assessment-audio';
import {
  listAssessmentAudioAttempts,
  verifyRetainedAssessmentAudioPublication,
} from './assessment-audio-attempt';
import { inspectAssessmentAudioLineageForDeletion } from './assessment-audio-lineage';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { resolveOwnedClassStorage } from '../lifecycle/assessment-storage-relocation';

type Operation = { id: string; fingerprint: string };
type State = { id: string; revision: string };

/** Capture only completed, owned audio and its drained jobs before admitting deletion. */
export async function inspectAssessmentAudioForDeletion(
  database: Prisma.TransactionClient,
  input: {
    classId: string;
    courseId: string;
    userId: string;
    ownership: Awaited<ReturnType<typeof capturePrerequisiteOwnership>>;
    assessments: readonly (Operation & { assessmentId: string })[];
    attempts: Awaited<ReturnType<typeof listAssessmentAudioAttempts>>;
  }
) {
  const scope = input.ownership.scopes.find((item) => item.subjectId === `class:${input.classId}`);
  if (!scope || input.attempts.some((attempt) => attempt.status !== 'COMPLETE'))
    throw new AssessmentFenceConflict();
  const jobs: Operation[] = [];
  const states: State[] = [];
  const episodeIds: string[] = [];
  const matchedAttempts = new Set<string>();
  const outbox = sottoJobOutbox(database);
  const executions = sottoJobExecutions(database);
  for (const parent of input.assessments) {
    const sections = await database.classAssessmentSection.findMany({
      where: { assessmentId: parent.assessmentId },
      include: {
        episode: { include: { segments: { orderBy: { order: 'asc' } } } },
        speakingPrompts: { include: { assessmentReference: true } },
      },
    });
    for (const section of sections) {
      for (const prompt of section.speakingPrompts) {
        if (prompt.assessmentReferenceIdentity === null) {
          if (prompt.referenceTtsUrl || prompt.assessmentReference)
            throw new AssessmentFenceConflict();
          continue;
        }
        const reference = assessmentSpeakingReferenceSchema.parse(
          prompt.assessmentReferenceIdentity
        );
        assessmentSpeakingReferenceIdentity(reference, {
          assessmentId: parent.assessmentId,
          promptId: prompt.id,
          userId: input.userId,
        });
        const current = prompt.assessmentReference?.currentUrl;
        if (
          !current ||
          prompt.referenceTtsUrl !== reference.reference.reference ||
          (reference.provenance &&
            (reference.provenance.operationId !== parent.id ||
              reference.provenance.fingerprint !== parent.fingerprint))
        )
          throw new AssessmentFenceConflict();
        const proof = await resolveOwnedClassStorage(database, {
          classId: input.classId,
          courseId: input.courseId,
          userId: input.userId,
          original: reference.reference,
          currentReference: current,
        });
        if (
          !matchesPublishedStorageIdentity(proof, {
            original: reference.reference,
            currentReference: current,
            contentSha256: reference.contentSha256,
            contentBytes: reference.contentBytes,
          })
        )
          throw new AssessmentFenceConflict();
      }
      const episode = section.episode;
      if (!episode) {
        if (
          section.episodeId ||
          section.audioReservationEpisodeId ||
          section.audioReservationOperationId ||
          section.audioIdentity !== null
        )
          throw new AssessmentFenceConflict();
        continue;
      }
      if (
        section.skill !== 'LISTENING' ||
        section.episodeId !== episode.id ||
        episode.assessmentAudioSectionId !== section.id ||
        section.audioReservationEpisodeId !== episode.id ||
        section.audioReservationOperationId !== parent.id ||
        !section.audioIdentity ||
        !episode.segments.length ||
        episodeIds.includes(episode.id)
      )
        throw new AssessmentFenceConflict();
      await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episode.id} FOR UPDATE`;
      const freeze = await database.assessmentAudioSourceFreeze.findUnique({
        where: { assessmentId: parent.assessmentId },
      });
      if (!freeze || freeze.classId !== input.classId || freeze.episodeId !== episode.id)
        throw new AssessmentFenceConflict();
      const lineage = await inspectAssessmentAudioLineageForDeletion(database, {
        classId: input.classId,
        courseId: input.courseId,
        userId: input.userId,
        assessmentId: parent.assessmentId,
        episodeId: episode.id,
        identity: { id: parent.id, fingerprint: parent.fingerprint },
        ownership: input.ownership,
      });
      if (
        lineage.generationKey !==
        durableQueueOperationId('assessment-audio', `${parent.id}:${episode.id}`)
      )
        throw new AssessmentFenceConflict();
      const association = lineage.storage.associations.assessmentSection;
      if (
        !association ||
        association.id !== section.id ||
        association.assessmentId !== parent.assessmentId ||
        association.classId !== input.classId
      )
        throw new AssessmentFenceConflict();
      states.push({ id: lineage.id, revision: lineage.revision });
      episodeIds.push(episode.id);
      for (const [index, segment] of episode.segments.entries()) {
        const operationId = durableQueueOperationId(
          'audio-generation',
          `audio-${episode.id}-${segment.id}-v${segment.version}-${lineage.generationKey}`
        );
        const attempt = input.attempts.find((item) => item.operationId === operationId);
        const child = await outbox.read(operationId);
        const voice = lineage.voices.find((item) => item.speaker === segment.speaker);
        const payload = {
          episodeId: episode.id,
          audioGenerationKey: lineage.generationKey,
          segmentId: segment.id,
          segmentVersion: segment.version,
          speaker: segment.speaker,
          text: segment.text,
          ...(index ? { previousText: episode.segments[index - 1]!.text.slice(-500) } : {}),
          ...(index < episode.segments.length - 1
            ? { nextText: episode.segments[index + 1]!.text.slice(0, 500) }
            : {}),
        };
        if (
          !attempt ||
          !child ||
          !voice ||
          !child.complete ||
          child.fingerprint !== attempt.fingerprint ||
          child.job.handler !== 'audio-generation' ||
          child.job.version !== 1 ||
          !isDeepStrictEqual(child.job.scopes, lineage.storage.scopes) ||
          attempt.assessmentId !== parent.assessmentId ||
          attempt.parentOperationId !== parent.id ||
          attempt.episodeId !== episode.id ||
          attempt.segmentId !== segment.id ||
          attempt.segmentVersion !== segment.version ||
          attempt.generationKey !== lineage.generationKey ||
          attempt.sourceDigest !==
            learningProviderInputHash({
              payload,
              storage: lineage.originalStorage,
              provider: lineage.provider,
              model: lineage.model,
              voice: { speaker: voice.speaker, provider: voice.provider, voiceId: voice.voiceId },
            })
        )
          throw new AssessmentFenceConflict();
        const envelope = durableEnvelopeSchema.parse(child.job.payload);
        if (
          envelope.type !== 'generate_audio' ||
          envelope.authority.kind !== 'episode' ||
          envelope.authority.episodeId !== episode.id ||
          envelope.authority.preparationAudioGenerationKey !== lineage.generationKey ||
          !isDeepStrictEqual(envelope.payload, payload)
        )
          throw new AssessmentFenceConflict();
        await verifyRetainedAssessmentAudioPublication(database, {
          ...attempt,
          classId: input.classId,
          courseId: input.courseId,
          userId: input.userId,
          classGeneration: scope.generation,
          scopes: child.job.scopes,
        });
        await executions.requireParentDrained(operationId, attempt.fingerprint);
        matchedAttempts.add(operationId);
        jobs.push({ id: operationId, fingerprint: attempt.fingerprint });
        states.push({ id: attempt.stateId, revision: attempt.revision });
      }
      const stitchState = await database.sidedoorState.findUnique({
        where: { id: initialStitchAttemptId(episode.id) },
      });
      const stitchBinding = stitchState?.state;
      if (
        !stitchState ||
        !stitchBinding ||
        typeof stitchBinding !== 'object' ||
        Array.isArray(stitchBinding) ||
        typeof stitchBinding.operationId !== 'string' ||
        typeof stitchBinding.fingerprint !== 'string'
      )
        throw new AssessmentFenceConflict();
      const stitch = await outbox.read(stitchBinding.operationId);
      if (
        !stitch ||
        !stitch.complete ||
        stitch.fingerprint !== stitchBinding.fingerprint ||
        stitch.job.handler !== 'audio-stitching' ||
        stitch.job.version !== 2 ||
        !isDeepStrictEqual(stitch.job.scopes, lineage.storage.scopes)
      )
        throw new AssessmentFenceConflict();
      const stitchPayload = initialStitchPayloadSchema.parse(stitch.job.payload);
      if (
        stitchPayload.inputs.episodeId !== episode.id ||
        stitchPayload.inputs.generationKey !== lineage.generationKey ||
        !isDeepStrictEqual(stitchPayload.inputs.storage, lineage.originalStorage) ||
        !isDeepStrictEqual(
          stitch.job,
          prepareInitialStitch(
            stitchPayload.inputs,
            stitchPayload.soundPolicy,
            stitch.job.id,
            stitchPayload.outputs
          )
        ) ||
        !['none', 'stock'].includes(stitchPayload.soundPolicy)
      )
        throw new AssessmentFenceConflict();
      await requireInitialStitchAttempt(database, episode.id, stitch.job.id, stitch.fingerprint);
      if (
        (
          await verifyInitialStitchPublication(database, stitch, undefined, {
            allowHistoricalAssessment: true,
          })
        ).kind !== 'READY'
      )
        throw new AssessmentFenceConflict();
      await executions.requireParentDrained(stitch.job.id, stitch.fingerprint);
      jobs.push({ id: stitch.job.id, fingerprint: stitch.fingerprint });
      states.push({ id: stitchState.id, revision: stitchState.revision });
    }
  }
  const allSections = await database.classAssessmentSection.findMany({
    where: { assessmentId: { in: input.assessments.map((item) => item.assessmentId) } },
    select: { id: true },
  });
  const markedEpisodes = await database.episode.findMany({
    where: {
      OR: [
        { assessmentAudioAssessmentId: { in: input.assessments.map((item) => item.assessmentId) } },
        { assessmentAudioSectionId: { in: allSections.map((item) => item.id) } },
        { assessmentAudioOperationId: { in: input.assessments.map((item) => item.id) } },
      ],
    },
    select: { id: true },
  });
  if (
    markedEpisodes.length !== episodeIds.length ||
    markedEpisodes.some((episode) => !episodeIds.includes(episode.id))
  )
    throw new AssessmentFenceConflict();
  if (
    matchedAttempts.size !== input.attempts.length ||
    new Set(jobs.map((job) => job.id)).size !== jobs.length
  )
    throw new AssessmentFenceConflict();
  return { jobs, states, episodeIds };
}
