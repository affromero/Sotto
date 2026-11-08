import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { assessmentWorkSchema, AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { publicAssessmentMaterial, type AssessmentScope } from './assessment-material';
import { recoverAssessmentOutcome } from '../lifecycle/assessment-outcome';
import { captureSealedAssessmentCandidate } from './assessment-snapshot';
import { requireAssessmentPracticeComplete } from '../practice/assessment-practice';
import { requireReadAloudAssessmentMaterial } from '../speaking/assessment-speaking-policy';

/** Capture the private material and its verified scope for server-side evaluation. */
export async function captureAssessmentForEvaluation(
  database: Prisma.TransactionClient,
  input: { classId: string; assessmentId: string; execution: SottoProviderExecution }
) {
  const actor = await input.execution.authorize(database);
  if (actor.userId !== input.execution.userId) throw new AssessmentFenceConflict();
  const assessment = await database.classAssessment.findFirst({
    where: {
      id: input.assessmentId,
      classId: input.classId,
      userId: actor.userId,
      class: { course: { userId: actor.userId } },
    },
  });
  if (!assessment?.generationOperationId || assessment.status !== 'READY')
    throw new AssessmentFenceConflict();
  const record = await sottoJobOutbox(database).read(assessment.generationOperationId);
  if (
    !record ||
    !record.complete ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(record.job.payload);
  if (
    fence.id !== assessment.generationOperationId ||
    fence.classId !== input.classId ||
    fence.assessmentId !== assessment.id ||
    fence.userId !== actor.userId
  )
    throw new AssessmentFenceConflict();
  const identity = { id: record.job.id, fingerprint: record.fingerprint };
  if (!(await recoverAssessmentOutcome(database, identity))) throw new AssessmentFenceConflict();
  await requireAssessmentPracticeComplete(database, {
    classId: fence.classId,
    classAttempt: fence.classAttempt,
    userId: actor.userId,
  });
  const candidate = await captureSealedAssessmentCandidate(database, input.execution, {
    classId: fence.classId,
    assessmentId: fence.assessmentId,
    classAttempt: fence.classAttempt,
    assessmentAttempt: fence.assessmentAttempt,
    ...(fence.materialVersion === 2 ? { materialVersion: 2 as const } : {}),
    generationOperationId: fence.id,
    ownership: fence.ownership,
  });
  if (candidate.status !== 'CAPTURED' || candidate.digest !== assessment.reviewedMaterialDigest)
    throw new AssessmentFenceConflict();
  if (fence.speakingPolicy) requireReadAloudAssessmentMaterial(candidate.material);
  const listening = candidate.material.sections.find(
    (section) => section.skill === 'LISTENING' && 'audio' in section
  );
  const listeningAudio = listening && 'audio' in listening ? listening.audio : null;
  const episode = listeningAudio
    ? await database.episode.findUnique({ where: { id: listeningAudio.episodeId } })
    : null;
  const speaking = candidate.material.sections.find((section) => section.skill === 'SPEAKING');
  const promptIds = speaking?.items.map((item) => item.id) ?? [];
  const prompts = await database.speakingPrompt.findMany({
    where: { id: { in: promptIds } },
    include: { assessmentReference: true },
  });
  const ownedSpeakingReferences = Object.fromEntries(
    (speaking?.items ?? []).map((item) => {
      const prompt = prompts.find((entry) => entry.id === item.id);
      if (!prompt) throw new AssessmentFenceConflict();
      return [
        item.id,
        item.referenceAudioId
          ? {
              id: item.referenceAudioId,
              status: 'READY',
              storageRef: prompt.assessmentReference?.currentUrl ?? null,
            }
          : null,
      ];
    })
  );
  const scope: AssessmentScope = {
    id: assessment.id,
    classId: assessment.classId,
    courseId: assessment.courseId,
    userId: assessment.userId,
    classAttempt: assessment.classAttempt,
    assessmentAttempt: assessment.assessmentAttempt,
    formativeRevision: assessment.formativeRevision,
    requirements: candidate.material.requirements,
    passThresholds: candidate.passThresholds,
    formativeItemIds: candidate.formativeIds,
    formativeTasks: candidate.formativeTasks,
    reviewedMaterialDigest: candidate.digest,
    review: {
      decision: 'ACCEPTED',
      materialDigest: candidate.digest,
      formativeRevision: assessment.formativeRevision,
    },
    ownedListening:
      listeningAudio && episode
        ? {
            episodeId: episode.id,
            mediaIdentity: listeningAudio.mediaIdentity,
            status: episode.status,
            audioUrl: episode.audioUrl,
            privateTranscript: listeningAudio.privateTranscript,
          }
        : null,
    ownedSpeakingReferences,
  };
  return {
    material: candidate.material,
    scope,
    audioSources: candidate.audioSources,
    ...(fence.speakingPolicy ? { speakingPolicy: fence.speakingPolicy } : {}),
  };
}

/** Read only the current owned, sealed material after authenticating its durable outcome. */
export async function readPublicAssessment(
  database: Prisma.TransactionClient,
  input: { classId: string; assessmentId: string; execution: SottoProviderExecution }
) {
  const { material, scope } = await captureAssessmentForEvaluation(database, input);
  return publicAssessmentMaterial(material, scope);
}
