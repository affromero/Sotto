import { expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalStorageCleanup } from 'thesidedoor-core/storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../../helpers/setup/shared-instance';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { captureAssessmentForEvaluation } from '@/lib/learning/classes/material/assessment-read';
import type { submitAssessment } from '@/lib/learning/classes/lifecycle/assessment-submission';

interface SpeakingSubmissionContext {
  root: string;
  classId: string;
  identity: SharedTestIdentity;
  captured: Awaited<ReturnType<typeof captureAssessmentForEvaluation>>;
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  selectedMode: string;
  instance: SharedTestInstance;
  cls: { courseId: string };
  submitAssessment: typeof submitAssessment;
  submission: Parameters<typeof submitAssessment>[0];
}

export async function checkSpeakingAssessmentSubmission({
  root,
  classId,
  identity,
  captured,
  fence,
  selectedMode,
  instance,
  cls,
  submitAssessment,
  submission,
}: SpeakingSubmissionContext) {
  const { setSiteConfig } = await import('@/lib/site-config');
  await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
  const speaking = captured.material.sections.find((section) => section.skill === 'SPEAKING');
  if (!speaking || speaking.skill !== 'SPEAKING') throw new Error('Speaking assessment missing');
  const { authenticateRequest } = await import('@/lib/api-keys');
  const { admitAssessmentSpeaking } =
    await import('@/lib/learning/classes/speaking/assessment-speaking-admission');
  const { processAssessmentSpeaking } =
    await import('@/workers/classes/assessment-speaking.worker');
  const request = new Request('http://localhost/api/assessment/speaking', {
    method: 'POST',
    headers: { cookie: `sotto_session=${identity.ownerToken}` },
  });
  const admission = await authenticateRequest(request);
  if (!admission) throw new Error('Missing learner session');
  for (const prompt of speaking.items) {
    let recording = await admitAssessmentSpeaking({
      request,
      admission,
      classId,
      assessmentId: fence.assessmentId,
      promptId: prompt.id,
      requestId: randomUUID(),
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      extension: 'webm',
      contentType: 'audio/webm',
    });
    if (
      selectedMode.startsWith('submission_speaking_retry') &&
      prompt.id === speaking.items[0]?.id
    ) {
      const storage = await import('@/lib/r2');
      const restore = vi
        .spyOn(storage, 'restoreStorageBackend')
        .mockRejectedValueOnce(new Error('Recording backend unavailable'));
      try {
        await expect(
          processAssessmentSpeaking(
            {
              id: recording.operationId,
              name: 'speaking-grading.v3',
              data: {
                operationId: recording.operationId,
                fingerprint: recording.fingerprint,
              },
            } as import('bullmq').Job<unknown>,
            AbortSignal.timeout(30_000)
          )
        ).rejects.toThrow('Recording backend unavailable');
      } finally {
        restore.mockRestore();
      }
      recording = await admitAssessmentSpeaking({
        request,
        admission,
        classId,
        assessmentId: fence.assessmentId,
        promptId: prompt.id,
        requestId: randomUUID(),
        audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
        extension: 'webm',
        contentType: 'audio/webm',
      });
    }
    if (
      selectedMode === 'submission_speaking_failed_cleanup' ||
      selectedMode === 'submission_speaking_failed_profile' ||
      selectedMode === 'submission_speaking_prelaunch_course' ||
      selectedMode === 'submission_speaking_prelaunch_profile'
    ) {
      const prelaunch =
        selectedMode === 'submission_speaking_prelaunch_course' ||
        selectedMode === 'submission_speaking_prelaunch_profile';
      if (prelaunch) {
        const { Queue, Worker, UnrecoverableError } = await import('bullmq');
        const { reconcileFailedAssessmentSpeakingPrelaunch } =
          await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-prelaunch');
        const redis = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
        const connection = {
          host: redis.hostname,
          port: Number(redis.port),
          maxRetriesPerRequest: null,
        };
        const prefix = `speaking-prelaunch-${randomUUID()}`;
        const queue = new Queue('speaking-grading', { connection, prefix });
        const worker = new Worker(
          queue.name,
          async () => {
            throw new UnrecoverableError('Synthetic prelaunch failure');
          },
          { connection, prefix, autorun: false }
        );
        try {
          const queued = await queue.add(
            'speaking-grading.v3',
            {
              operationId: recording.operationId,
              fingerprint: recording.fingerprint,
            },
            { jobId: recording.operationId, attempts: 3, priority: 0 }
          );
          void worker.run();
          await expect.poll(() => queued.getState(), { timeout: 10000 }).toBe('failed');
          await worker.close();
          expect(
            await reconcileFailedAssessmentSpeakingPrelaunch({
              database: instance.database,
              queue,
              identity: {
                id: recording.operationId,
                fingerprint: recording.fingerprint,
              },
              signal: AbortSignal.timeout(30000),
            })
          ).toBe(true);
        } finally {
          await worker.close();
          await queue.obliterate({ force: true });
          await queue.close();
        }
      } else {
        const storage = await import('@/lib/r2');
        const restore = vi
          .spyOn(storage, 'restoreStorageBackend')
          .mockRejectedValueOnce(new Error('Recording backend unavailable'));
        try {
          await expect(
            processAssessmentSpeaking(
              {
                id: recording.operationId,
                name: 'speaking-grading.v3',
                data: {
                  operationId: recording.operationId,
                  fingerprint: recording.fingerprint,
                },
              } as import('bullmq').Job<unknown>,
              AbortSignal.timeout(30_000)
            )
          ).rejects.toThrow('Recording backend unavailable');
        } finally {
          restore.mockRestore();
        }
      }
      const saved = await instance.database.speakingRecording.findUniqueOrThrow({
        where: { id: recording.id },
      });
      expect(saved.status).toBe('FAILED');
      const { assessmentSpeakingPrelaunchReceiptId } =
        await import('@/lib/learning/classes/speaking/lifecycle/assessment-speaking-prelaunch-receipt');
      if (prelaunch)
        expect(
          await instance.database.sidedoorState.findUnique({
            where: { id: assessmentSpeakingPrelaunchReceiptId(recording.operationId) },
          })
        ).not.toBeNull();
      const path = join(
        root,
        decodeURIComponent(saved.audioUrl.slice(LOCAL_STORAGE_URL_PREFIX.length + 1))
      );
      expect((await readFile(path)).length).toBeGreaterThan(0);
      const course = await instance.database.course.findUniqueOrThrow({
        where: { id: cls.courseId },
      });
      const profile = await instance.database.user.findUniqueOrThrow({
        where: { id: identity.ownerId },
      });
      const { admitLearningStorageDeletion } =
        await import('@/lib/sidedoor/access/deletion/learning-deletion');
      const { runSottoStorageCleanup } =
        await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
      const { openSottoStorageConnection } =
        await import('@/lib/sidedoor/storage/core/storage-connection');
      const backend = await capturedLocalBackend(
        await LocalStorageCleanup.capture(root),
        root,
        LOCAL_STORAGE_URL_PREFIX,
        () => {}
      );
      const deletingProfile =
        selectedMode === 'submission_speaking_failed_profile' ||
        selectedMode === 'submission_speaking_prelaunch_profile';
      const jobs = await sottoTransaction(instance.database, async (tx) => {
        const admitted = await admitLearningStorageDeletion({
          database: tx,
          scope: deletingProfile
            ? { kind: 'profile', id: profile.id }
            : { kind: 'course', id: course.id, episodeIds: [] },
          subjects: [
            deletingProfile
              ? {
                  subjectId: `profile:${profile.id}`,
                  generation: profile.createdAt.getTime(),
                }
              : {
                  subjectId: `course:${course.id}`,
                  generation: course.createdAt.getTime(),
                },
          ],
          currentBackend: backend,
        });
        if (deletingProfile) await tx.user.delete({ where: { id: profile.id } });
        else await tx.course.delete({ where: { id: course.id } });
        return admitted;
      });
      for (const cleanup of jobs)
        await runSottoStorageCleanup(instance.database, cleanup.id, {
          openConnection: () =>
            openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
        });
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
      if (prelaunch)
        expect(
          await instance.database.sidedoorState.findUnique({
            where: { id: assessmentSpeakingPrelaunchReceiptId(recording.operationId) },
          })
        ).toBeNull();
      return true;
    }
    await processAssessmentSpeaking(
      {
        id: recording.operationId,
        name: 'speaking-grading.v3',
        data: {
          operationId: recording.operationId,
          fingerprint: recording.fingerprint,
        },
      } as import('bullmq').Job<unknown>,
      AbortSignal.timeout(30_000)
    );
  }
  const scoredSpeaking = await instance.database.speakingRecording.findFirstOrThrow({
    where: { assessmentSectionId: speaking.id, status: 'SCORED' },
  });
  await instance.database.speakingRecording.update({
    where: { id: scoredSpeaking.id },
    data: { overallScore: 1 },
  });
  try {
    await expect(submitAssessment(submission)).rejects.toThrow();
    expect(
      await instance.database.classAssessmentSubmission.count({
        where: { assessmentId: fence.assessmentId },
      })
    ).toBe(0);
  } finally {
    await instance.database.speakingRecording.update({
      where: { id: scoredSpeaking.id },
      data: { overallScore: scoredSpeaking.overallScore },
    });
  }

  return false;
}
