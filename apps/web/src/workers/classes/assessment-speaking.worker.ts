import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { capturedLearningAiOptions, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { assessmentSpeakingInputDigest } from '@/lib/learning/classes/speaking/assessment-speaking-identity';
import {
  assessmentSpeakingGradeDigest,
  assessmentSpeakingReceiptSchema,
} from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-receipt';
import {
  captureAssessmentSpeakingWork,
  verifyAssessmentSpeakingAudio,
} from '@/lib/learning/classes/speaking/assessment-speaking-work';
import { AssessmentFenceConflict } from '@/lib/learning/classes/lifecycle/assessment-fence';
import { settleCompletedAssessmentSpeaking } from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-recovery';
import { settleAssessmentSpeakingFailure } from '@/lib/learning/classes/speaking/lifecycle/assessment-speaking-failure';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { prismaUnfiltered } from '@/lib/prisma';
import { resolvePronunciationScorer } from '@/lib/pronunciation/scorer';
import { aiProviderRules } from '@/lib/providers/ai';
import { resolveCapturedSttProvider, type SttProviderId } from '@/lib/providers/stt';
import { restoreStorageBackend } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSottoProviderTransport,
  type SottoProviderExecution,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { readSottoWorkerJob, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { isDurableQueueCleanupFailure } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  runSottoExecutionOperation,
  verifySottoExecutionOperation,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';

/** Execute a held-out read-aloud job once, preserving uncertain provider work. */
export async function processAssessmentSpeaking(job: Job<unknown>, signal: AbortSignal) {
  const work = await sottoTransaction(
    prismaUnfiltered,
    (database) =>
      readSottoWorkerJob(database, job, {
        handler: 'speaking-grading',
        version: 3,
        payload: assessmentSpeakingGradingPayloadSchema,
      }),
    { signal }
  );
  if (work.complete) return;
  const { payload } = work;
  const recovered = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const recording = await database.speakingRecording.findUnique({
        where: { id: payload.recordingId },
        select: { status: true },
      });
      if (recording?.status !== 'SCORED') return false;
      if (!(await settleCompletedAssessmentSpeaking(database, work, signal)))
        throw new AssessmentFenceConflict();
      return true;
    },
    { signal }
  );
  if (recovered) return;
  const identity = { parentId: work.operationId, fingerprint: work.fingerprint };
  const baseExecution: SottoProviderExecution = {
    userId: payload.assessment.userId,
    signal,
    learningSelection: payload.assessment.gradingSelection,
    authorize: async (database) => {
      const ownership = await capturePrerequisiteOwnership(
        database,
        payload.assessment.classId,
        payload.assessment.courseId,
        payload.assessment.userId
      );
      if (
        ownership.instanceId !== payload.ownership.instanceId ||
        !isDeepStrictEqual(ownership.scopes, work.scopes)
      )
        throw new AssessmentFenceConflict();
      return { userId: payload.assessment.userId };
    },
  };
  const grant = (database: Prisma.TransactionClient) =>
    learningPreparationGrant(
      database,
      {
        id: work.operationId,
        userId: payload.assessment.userId,
        courseId: payload.assessment.courseId,
      },
      'speaking'
    );
  const scope = work.scopes.find(
    (entry) => entry.subjectId === `class:${payload.assessment.classId}`
  );
  if (!scope) throw new AssessmentFenceConflict();
  let uncertain = false;
  try {
    await withSottoJobExecution({
      database: prismaUnfiltered,
      parentId: work.operationId,
      fingerprint: work.fingerprint,
      capabilityScope: scope,
      signal,
      isCleanupFailure: (error) => uncertain || isDurableQueueCleanupFailure(error),
      validate: async (database) => {
        const captured = await captureAssessmentSpeakingWork(database, {
          operationId: work.operationId,
          fingerprint: work.fingerprint,
          execution: baseExecution,
        });
        if (!isDeepStrictEqual(captured.payload, payload) || captured.grant.attempts.length !== 0)
          throw new AssessmentFenceConflict();
        const claimId = `${SIDEDOOR_STATE_ID}:assessment-speaking-launch:${work.operationId}`;
        if (await database.sidedoorState.findUnique({ where: { id: claimId } }))
          throw new AssessmentFenceConflict();
        await database.sidedoorState.create({
          data: {
            id: claimId,
            revision: randomUUID(),
            state: { operationId: work.operationId, fingerprint: work.fingerprint },
          },
        });
        return true;
      },
      run: async ({ capability, directory, markCleanupUnconfirmed }) => {
        if (!capability) throw new AssessmentFenceConflict();
        return runSottoExecutionOperation(capability, identity, async (effect, effectSignal) => {
          const verify = async (database: Prisma.TransactionClient) => {
            const captured = await captureAssessmentSpeakingWork(database, {
              operationId: work.operationId,
              fingerprint: work.fingerprint,
              execution: baseExecution,
            });
            if (!isDeepStrictEqual(captured.payload, payload)) throw new AssessmentFenceConflict();
            await verifySottoExecutionOperation(database, effect, identity);
            return captured;
          };
          const markUnknown = () => {
            uncertain = true;
            markCleanupUnconfirmed();
          };
          const providerRequest = learningPreparationProviderRequest(
            {
              selection: payload.assessment,
              admit: async (database, attempt) => {
                await verify(database);
                return grant(database).admit(payload.grant, attempt);
              },
              settle: async (database, attempt, outcome) => {
                await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${payload.assessment.classId} FOR UPDATE`;
                await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${payload.assessment.assessmentId} FOR UPDATE`;
                await verifySottoExecutionOperation(database, effect, identity);
                return grant(database).settle(payload.grant, attempt, outcome);
              },
            },
            effectSignal,
            markUnknown
          );
          const execution: SottoProviderExecution = {
            ...baseExecution,
            signal: effectSignal,
            providerRequest,
            isolatedWorkspace: { directory, markCleanupUnconfirmed: markUnknown },
            onCleanupError: markUnknown,
          };
          const current = await sottoTransaction(prismaUnfiltered, verify, {
            signal: effectSignal,
          });
          const reader = await restoreStorageBackend(current.backend.descriptor);
          const path = join(directory, 'recording');
          await reader.downloadToFile(payload.storage.key, path, effectSignal);
          const audio = await readFile(path, { signal: effectSignal });
          verifyAssessmentSpeakingAudio(audio, payload.assessment.audio);
          const ai = await resolveCapturedLearningAi(execution.userId, execution);
          const rules = aiProviderRules(ai.provider, ai.endpoint);
          if (!rules.length)
            throw new Error(
              'This speaking assessment provider does not support durable execution.'
            );
          const transport = await createSottoProviderTransport(ai.execution, rules);
          const aiOptions = await capturedLearningAiOptions(ai);
          const speech = await resolveCapturedSttProvider({
            userId: execution.userId,
            execution,
            requestedProvider: payload.assessment.selection.providerId as SttProviderId,
            requestedModel: payload.assessment.selection.model,
            language: current.task.requirements.targetLang,
          });
          if (!isDeepStrictEqual(speech.selection, payload.assessment.selection))
            throw new AssessmentFenceConflict();
          const transcript = await speech.provider.transcribe(audio, {
            language: current.task.requirements.targetLang,
            signal: effectSignal,
          });
          const score = await resolvePronunciationScorer({}).score({
            targetPhrase: current.task.prompt.task,
            transcript: transcript.text,
            wordTimings: transcript.words,
            targetLang: current.task.requirements.targetLang,
            aiOptions,
            aiProvider: ai.provider,
            aiModel: ai.model,
            aiApiKey: ai.apiKey,
            aiEndpoint: ai.endpoint,
            userId: execution.userId,
            signal: effectSignal,
            fetch: (request, init) => transport.authenticatedFetch(request, init),
          });
          await sottoTransaction(
            prismaUnfiltered,
            async (database) => {
              await verify(database);
              const receipt = assessmentSpeakingReceiptSchema.parse({
                version: 1,
                operationId: work.operationId,
                fingerprint: work.fingerprint,
                recordingId: payload.recordingId,
                inputDigest: assessmentSpeakingInputDigest(payload.assessment),
                score: score.overallScore,
                gradeDigest: assessmentSpeakingGradeDigest(score),
              });
              const snapshots = sottoJobSnapshot(database);
              await snapshots.createForJob({ id: work.operationId, fingerprint: work.fingerprint });
              await snapshots.append(work.operationId, work.fingerprint, 0, [receipt]);
              await snapshots.seal(work.operationId, work.fingerprint);
              await database.speakingRecording.update({
                where: { id: payload.recordingId },
                data: {
                  transcript: score.transcript,
                  overallScore: score.overallScore,
                  rubricScores: score.rubricScores as unknown as Prisma.InputJsonValue,
                  phonemeScores: score.phonemeScores as unknown as Prisma.InputJsonValue,
                  feedback: score.feedback,
                  status: 'SCORED',
                },
              });
              await grant(database).complete(payload.grant);
              await verifySottoExecutionOperation(database, effect, identity);
            },
            { signal: effectSignal }
          );
        });
      },
    });
  } catch (error) {
    try {
      await sottoTransaction(
        prismaUnfiltered,
        (database) => settleAssessmentSpeakingFailure(database, work),
        { signal: AbortSignal.timeout(30_000) }
      );
    } catch (settlementError) {
      throw new AggregateError(
        [error, settlementError],
        'Speaking failure could not be reconciled'
      );
    }
    throw error;
  }
  const settled = await sottoTransaction(
    prismaUnfiltered,
    (database) => settleCompletedAssessmentSpeaking(database, work, signal),
    { signal }
  );
  if (!settled) throw new AssessmentFenceConflict();
}
