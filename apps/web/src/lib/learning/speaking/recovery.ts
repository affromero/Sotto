import { isDeepStrictEqual } from 'node:util';
import { AccessError } from 'thesidedoor-core/access';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  classSpeakingGradingPayloadSchema,
  speakingGradingPayloadSchema,
} from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { readInitialA1PracticeAuthorization } from '@/lib/classes/lesson/initial-a1-provenance';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { isCurrentClassSection } from '@/lib/learning/classes/progress/current-sections';

/** Acknowledgment permits a new recording. It never resolves the earlier provider outcome. */
export async function acknowledgeUnresolvedSpeaking(input: {
  classId: string;
  promptId: string;
  recordingId: string;
  execution: SottoProviderExecution;
}) {
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await input.execution.authorize(database);
      if (actor.userId !== input.execution.userId) throw new AccessError('unauthorized');
      await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
      const prompt = await database.speakingPrompt.findFirst({
        where: {
          id: input.promptId,
          section: { classId: input.classId, class: { course: { userId: actor.userId } } },
        },
        select: {
          sectionId: true,
          section: {
            select: {
              classId: true,
              skill: true,
              attempt: true,
              withdrawn: true,
              class: { select: { status: true, courseId: true } },
            },
          },
        },
      });
      if (!prompt?.section || !prompt.sectionId) return null;
      const recording = await database.speakingRecording.findFirst({
        where: {
          id: input.recordingId,
          promptId: input.promptId,
          userId: actor.userId,
          sectionId: prompt.sectionId,
        },
      });
      if (!recording) return null;
      if (
        recording.status !== 'UNRESOLVED' ||
        !recording.gradingOperationId ||
        recording.attempt !== prompt.section.attempt ||
        !(await isCurrentClassSection(database, prompt.section)) ||
        !['AVAILABLE', 'IN_PROGRESS'].includes(prompt.section.class.status)
      )
        throw new AccessError('conflict', 'This recording cannot be acknowledged here');
      await readInitialA1PracticeAuthorization(database, input.classId, actor.userId);
      const work = await sottoJobOutbox(database).read(recording.gradingOperationId);
      if (
        !work ||
        !work.complete ||
        work.job.handler !== 'speaking-grading' ||
        ![1, 2].includes(work.job.version)
      )
        throw new AccessError('conflict', 'The earlier grading work needs operator recovery');
      const payload =
        work.job.version === 2
          ? classSpeakingGradingPayloadSchema.parse(work.job.payload)
          : speakingGradingPayloadSchema.parse(work.job.payload);
      const parent = payload.ownership.associations.parents.find(
        (candidate) =>
          candidate.kind === 'class' &&
          candidate.parentId === input.classId &&
          candidate.id === prompt.sectionId &&
          candidate.courseId === prompt.section?.class.courseId
      );
      if (
        payload.recordingId !== recording.id ||
        payload.recordingCreatedAt !== recording.createdAt.getTime() ||
        !parent ||
        !isDeepStrictEqual(
          await captureSpeakingRecordingStorage(database, recording.id),
          payload.ownership
        )
      )
        throw new AccessError('conflict', 'The earlier recording identity changed');
      const ownership = await capturePrerequisiteOwnership(
        database,
        input.classId,
        prompt.section.class.courseId,
        actor.userId
      );
      const requiredScopes = ownership.scopes.filter(
        (scope) => work.job.version === 2 || scope.subjectId !== `class:${input.classId}`
      );
      if (
        !requiredScopes.every((scope) =>
          work.job.scopes.some((captured) => isDeepStrictEqual(scope, captured))
        )
      )
        throw new AccessError('conflict', 'The earlier class identity changed');
      if (work.job.version === 2) {
        const current = classSpeakingGradingPayloadSchema.parse(work.job.payload);
        if (
          current.grant.id !== work.job.id ||
          current.classAuthorization.classId !== input.classId
        )
          throw new AccessError('conflict', 'The earlier recording identity changed');
        const grant = await learningPreparationGrant(
          database,
          {
            id: work.job.id,
            userId: actor.userId,
            courseId: prompt.section.class.courseId,
          },
          'speaking'
        ).read(current.grant);
        if (grant.status !== 'revoked')
          throw new AccessError('conflict', 'The earlier grading work needs operator recovery');
      }
      try {
        await sottoJobExecutions(database).requireParentDrained(work.job.id, work.fingerprint);
      } catch {
        throw new AccessError(
          'conflict',
          'Execution cleanup is not confirmed. Contact your server administrator.'
        );
      }
      if (!recording.gradingAcknowledgedAt)
        await database.speakingRecording.update({
          where: { id: recording.id },
          data: { gradingAcknowledgedAt: new Date() },
        });
      return { acknowledged: true as const };
    },
    { signal: input.execution.signal }
  );
}
