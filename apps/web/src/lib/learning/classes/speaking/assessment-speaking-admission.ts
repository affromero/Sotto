import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { captureLearningModerationCredential, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import {
  getConfiguredSttProviderId,
  resolveCapturedSttProvider,
  type SttProviderId,
} from '@/lib/providers/stt';
import { getServerInfra } from '@/lib/server-config';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  captureSottoExecutionCredential,
  validateSottoExecutionCredential,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import {
  captureSpeakingPromptStorage,
  captureSpeakingRecordingStorage,
} from '@/lib/sidedoor/storage/core/speaking-storage';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { assessmentSpeakingInput } from './assessment-speaking-identity';
import { READ_ALOUD_ASSESSMENT_POLICY } from './assessment-speaking-policy';
import { captureAssessmentSpeakingTask } from './assessment-speaking-task';
import { verifyFailedSpeakingForDeletion } from './lifecycle/assessment-speaking-failed-verification';

class AssessmentRecordingExists extends Error {
  constructor() {
    super('This assessment response already has a recording.');
  }
}

/** Admit one owned recording and its grading work. A request ID may only replay exact bytes. */
export async function admitAssessmentSpeaking(input: {
  request: Request;
  admission: AuthenticatedRequest;
  classId: string;
  assessmentId: string;
  promptId: string;
  requestId: string;
  audio: Uint8Array;
  extension: string;
  contentType: string;
}) {
  const requestId = z.uuid().parse(input.requestId);
  const audio = Buffer.from(input.audio);
  const execution = sottoRequestExecution(input.request, input.admission);
  const capture = async (database: Parameters<typeof captureAssessmentSpeakingTask>[0]) => {
    await requireOriginalSottoAdmission(database, input.request, input.admission);
    await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
    await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
    const captured = await captureAssessmentSpeakingTask(database, { ...input, execution });
    if (captured.speakingPolicy !== READ_ALOUD_ASSESSMENT_POLICY)
      throw new AssessmentFenceConflict();
    return captured;
  };
  const readReplay = () =>
    sottoTransaction(
      prisma,
      async (database) => {
        const captured = await capture(database);
        const record = await sottoJobOutbox(database).read(requestId);
        const recording = await database.speakingRecording.findUnique({ where: { id: requestId } });
        if (!record && !recording) return { captured, replay: null };
        if (
          !record ||
          !recording ||
          record.job.handler !== 'speaking-grading' ||
          record.job.version !== 3
        )
          throw new AssessmentFenceConflict();
        const payload = assessmentSpeakingGradingPayloadSchema.parse(record.job.payload);
        const expected = assessmentSpeakingInput({
          task: captured.task,
          speakingPolicy: captured.speakingPolicy,
          operationId: requestId,
          recordingId: requestId,
          audio,
          contentType: input.contentType,
          selection: payload.assessment.selection,
          gradingSelection: payload.assessment.gradingSelection,
        });
        const ownership = await captureSpeakingRecordingStorage(database, requestId);
        const storage = await resolveStorageInput(database, {
          consumer: payload.storage.consumer,
          reference: recording.audioUrl,
        });
        if (
          !isDeepStrictEqual(expected, payload.assessment) ||
          !isDeepStrictEqual(ownership, payload.ownership) ||
          !isDeepStrictEqual(storage.input, payload.storage) ||
          !isDeepStrictEqual(record.job.scopes, ownership.scopes) ||
          recording.gradingOperationId !== requestId ||
          !isDeepStrictEqual(recording.sttSelection, payload.assessment.selection)
        )
          throw new AssessmentFenceConflict();
        await learningPreparationGrant(
          database,
          { id: requestId, userId: captured.task.userId, courseId: captured.task.courseId },
          'speaking'
        ).read(payload.grant);
        return {
          captured,
          replay: {
            id: requestId,
            operationId: requestId,
            fingerprint: record.fingerprint,
            status: recording.status,
          },
        };
      },
      { signal: input.request.signal }
    );
  const replay = await readReplay();
  if (replay.replay) return replay.replay;
  const preferred = await sottoTransaction(
    prisma,
    async (database) => {
      const current = await capture(database);
      if (!isDeepStrictEqual(current, replay.captured)) throw new AssessmentFenceConflict();
      return database.user.findUniqueOrThrow({
        where: { id: input.admission.userId },
        select: { preferredSttModel: true },
      });
    },
    { signal: input.request.signal }
  );
  await getServerInfra();
  const stt = await resolveCapturedSttProvider({
    userId: input.admission.userId,
    execution,
    requestedProvider:
      (replay.captured.task.requirements.sttProvider as SttProviderId | null) ??
      getConfiguredSttProviderId(),
    requestedModel: preferred.preferredSttModel ?? undefined,
    language: replay.captured.task.requirements.targetLang,
  });
  const ai = await resolveCapturedLearningAi(input.admission.userId, execution);
  if (['codex', 'claude-code'].includes(ai.provider))
    throw new Error('This speaking assessment provider does not support durable execution.');
  const moderation = await captureLearningModerationCredential(execution);
  const gradingSelection = {
    provider: ai.provider,
    model: ai.model,
    ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
    ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
    credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
    moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
  };
  const assessment = assessmentSpeakingInput({
    task: replay.captured.task,
    speakingPolicy: replay.captured.speakingPolicy,
    operationId: requestId,
    recordingId: requestId,
    audio,
    contentType: input.contentType,
    selection: stt.selection,
    gradingSelection,
  });
  const validate = async (database: Parameters<typeof captureAssessmentSpeakingTask>[0]) => {
    const current = await capture(database);
    if (!isDeepStrictEqual(current, replay.captured)) throw new AssessmentFenceConflict();
    if (ai.execution.credential)
      await validateSottoExecutionCredential(
        database,
        execution.authorize,
        ai.execution.credential,
        input.request.signal
      );
    if (moderation)
      await validateSottoExecutionCredential(
        database,
        execution.authorize,
        moderation,
        input.request.signal
      );
    const speechCredential = await captureSottoExecutionCredential(
      database,
      execution.authorize,
      'stt',
      stt.selection.providerId,
      true,
      input.request.signal
    );
    const moderationCredential = await captureSottoExecutionCredential(
      database,
      execution.authorize,
      'ai',
      'openai',
      true,
      input.request.signal
    );
    if (
      learningCredentialFingerprint(speechCredential) !== stt.selection.credentialFingerprint ||
      learningCredentialFingerprint(moderationCredential) !==
        gradingSelection.moderationCredentialFingerprint
    )
      throw new AssessmentFenceConflict();
  };
  const requireRetryableRecordings = async (
    database: Parameters<typeof captureAssessmentSpeakingTask>[0]
  ) => {
    const previous = await database.speakingRecording.findMany({
      where: {
        assessmentSectionId: replay.captured.task.sectionId,
        promptId: input.promptId,
        attempt: replay.captured.task.assessmentAttempt,
      },
      orderBy: { id: 'asc' },
    });
    for (const recording of previous) {
      if (recording.status !== 'FAILED' || !recording.gradingOperationId)
        throw new AssessmentRecordingExists();
      const record = await sottoJobOutbox(database).read(recording.gradingOperationId);
      if (!record) throw new AssessmentFenceConflict();
      await verifyFailedSpeakingForDeletion(database, {
        classId: input.classId,
        courseId: replay.captured.task.courseId,
        userId: input.admission.userId,
        assessmentId: input.assessmentId,
        recordingId: recording.id,
        operationId: record.job.id,
        fingerprint: record.fingerprint,
      });
      await sottoJobExecutions(database).requireParentDrained(record.job.id, record.fingerprint);
    }
  };
  let fingerprint: string | undefined;
  try {
    await writeStorageReference({
      database: prisma,
      signal: input.request.signal,
      prefix: `speaking/${input.admission.userId}/${input.promptId}`,
      extension: input.extension,
      body: audio,
      contentType: input.contentType,
      captureAdmission: async (database) => {
        await validate(database);
        const prompt = await captureSpeakingPromptStorage(database, input.promptId);
        const ownership = await capturePrerequisiteOwnership(
          database,
          input.classId,
          replay.captured.task.courseId,
          input.admission.userId
        );
        if (
          !isDeepStrictEqual(prompt.scopes, ownership.scopes) ||
          prompt.instanceId !== ownership.instanceId
        )
          throw new AssessmentFenceConflict();
        await requireRetryableRecordings(database);
        return {
          instanceId: ownership.instanceId,
          scopes: ownership.scopes,
          consumer: `recording:${requestId}:audio`,
          snapshot: replay.captured,
        };
      },
      validateAdmission: async (database, captured, committedReference) => {
        await validate(database);
        if (!isDeepStrictEqual(captured.snapshot, replay.captured))
          throw new AssessmentFenceConflict();
        if (committedReference) {
          const saved = await database.speakingRecording.findUnique({ where: { id: requestId } });
          if (
            !saved ||
            saved.audioUrl !== committedReference ||
            saved.gradingOperationId !== requestId
          )
            throw new AssessmentFenceConflict();
        } else await requireRetryableRecordings(database);
      },
      previousReference: () => null,
      commit: async (database, audioUrl) => {
        const recording = await database.speakingRecording.create({
          data: {
            id: requestId,
            gradingOperationId: requestId,
            assessmentSectionId: replay.captured.task.sectionId,
            promptId: input.promptId,
            userId: input.admission.userId,
            attempt: replay.captured.task.assessmentAttempt,
            audioUrl,
            sttProvider: replay.captured.task.requirements.sttProvider,
            sttSelection: stt.selection,
            status: 'PENDING',
          },
        });
        const ownership = await captureSpeakingRecordingStorage(database, recording.id);
        const storage = await resolveStorageInput(database, {
          consumer: `recording:${recording.id}:audio`,
          reference: audioUrl,
        });
        const profile = ownership.scopes.find(
          (scope) => scope.subjectId === `profile:${input.admission.userId}`
        );
        const course = ownership.scopes.find(
          (scope) => scope.subjectId === `course:${replay.captured.task.courseId}`
        );
        if (!profile || !course) throw new AssessmentFenceConflict();
        const grant = {
          id: requestId,
          revision: randomUUID(),
          instanceId: ownership.instanceId,
          subject: { id: profile.subjectId, generation: profile.generation },
          resource: { id: course.subjectId, generation: course.generation },
          operationId: requestId,
          action: 'speaking-parent-provider-request',
          expiresAt: Date.now() + 24 * 60 * 60_000,
          maxRequests: 256,
        };
        const payload = assessmentSpeakingGradingPayloadSchema.parse({
          recordingId: recording.id,
          recordingCreatedAt: recording.createdAt.getTime(),
          storage: storage.input,
          ownership,
          grant: delegationGrantBinding(grant),
          assessment,
        });
        const record = await sottoJobOutbox(database).enqueue(
          prepareJob({
            id: requestId,
            namespace: SIDEDOOR_STATE_ID,
            handler: 'speaking-grading',
            version: 3,
            payload,
            scopes: ownership.scopes,
            delivery: { attempts: 3, priority: 0, availableAt: 0 },
          })
        );
        await learningPreparationGrant(
          database,
          {
            id: requestId,
            userId: input.admission.userId,
            courseId: replay.captured.task.courseId,
          },
          'speaking'
        ).create(grant);
        fingerprint = record.fingerprint;
      },
    });
  } catch (error) {
    if (!(error instanceof AssessmentRecordingExists)) throw error;
    const saved = await readReplay();
    if (saved.replay) return saved.replay;
    throw new AccessError('conflict', error.message);
  }
  if (!fingerprint) {
    const saved = await readReplay();
    if (saved.replay) return saved.replay;
    throw new Error('Assessment speaking work was not committed.');
  }
  return { id: requestId, operationId: requestId, fingerprint, status: 'PENDING' as const };
}
