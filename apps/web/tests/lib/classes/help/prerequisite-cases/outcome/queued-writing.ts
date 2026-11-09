import { expect, vi, type Mock } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { LocalStorageCleanup } from 'thesidedoor-core/storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { admitAssessmentWriting } from '@/lib/learning/classes/writing/assessment-writing-admission';
import type { captureAssessmentWritingTask } from '@/lib/learning/classes/writing/assessment-writing-read';
import type { captureAssessmentForEvaluation } from '@/lib/learning/classes/material/assessment-read';

interface QueuedWritingContext {
  audioQueue: typeof import('@/lib/queue') | undefined;
  instance: SharedTestInstance;
  admitAssessmentWriting: typeof admitAssessmentWriting;
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  heldOutWriting: { id: string };
  writingCapture: Awaited<ReturnType<typeof captureAssessmentWritingTask>>;
  provider: { generate: Mock };
  boundary: { execution: SottoProviderExecution | null };
  execution: SottoProviderExecution;
  readWritingHttp: (token: string, promptId?: string) => Promise<Response>;
  identity: SharedTestIdentity;
  root: string;
  classId: string;
  cls: { courseId: string };
  writingSection: Extract<
    Awaited<ReturnType<typeof captureAssessmentForEvaluation>>['material']['sections'][number],
    { skill: 'WRITING' }
  >;
  writingTask: (
    promptId: string,
    learnerId?: string
  ) => ReturnType<typeof captureAssessmentWritingTask>;
  selection: Parameters<typeof admitAssessmentWriting>[1]['selection'];
}

export async function checkQueuedAssessmentWriting({
  audioQueue,
  instance,
  admitAssessmentWriting,
  fence,
  heldOutWriting,
  writingCapture,
  provider,
  boundary,
  execution,
  readWritingHttp,
  identity,
  root,
  classId,
  cls,
  writingSection,
  writingTask,
  selection,
}: QueuedWritingContext) {
  if (!audioQueue) throw new Error('Private queue is unavailable');
  const queued = await sottoTransaction(instance.database, (tx) =>
    admitAssessmentWriting(tx, {
      classId,
      assessmentId: fence.assessmentId,
      promptId: heldOutWriting.id,
      text: 'Мой ответ.',
      execution,
      selection,
      expected: writingCapture,
      queued: true,
    })
  );
  let writingDispatches = 0;
  provider.generate.mockImplementationOnce(async () => {
    const request = boundary.execution?.providerRequest;
    if (!request) throw new Error('Writing provider journal missing');
    const response = await request(
      new Request('https://provider.example/writing', {
        method: 'POST',
        body: 'fixture',
      }),
      async () => {
        writingDispatches += 1;
        return Response.json({ overallScore: 0.75, corrections: [], feedback: 'Bien.' });
      }
    );
    return { content: await response.text(), model: 'fixture' };
  });
  const { Queue, Worker } = await import('bullmq');
  const { deliverSottoJob } = await import('@/lib/sidedoor/jobs/core/job-delivery');
  const { runQueuedAssessmentWriting } =
    await import('@/lib/learning/classes/writing/assessment-writing-run');
  const url = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
  const queue = new Queue('learning-writing', {
    connection: {
      host: url.hostname,
      port: Number(url.port),
      maxRetriesPerRequest: null,
    },
  });
  const worker = audioQueue.createWorker('learning-writing', runQueuedAssessmentWriting, {
    concurrency: 1,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    worker.on('completed', (item) => {
      if (item.id === queued.operation.id) resolve();
    });
    worker.on('failed', (item, error) => {
      if (item?.id === queued.operation.id) reject(error);
    });
    timer = setTimeout(() => reject(new Error('Writing worker did not finish')), 30000);
  });
  try {
    await deliverSottoJob({
      database: instance.database,
      queue,
      operationId: queued.operation.id,
      fingerprint: queued.operation.fingerprint,
      version: 3,
    });
    await finished;
    const job = await queue.getJob(queued.operation.id);
    if (!job) throw new Error('Queued writing job missing');
    expect(job.data).toEqual({
      operationId: queued.operation.id,
      fingerprint: queued.operation.fingerprint,
    });
    expect(writingDispatches).toBe(1);
    expect(await (await readWritingHttp(identity.ownerToken)).json()).toEqual({
      status: 'COMPLETED',
      text: 'Мой ответ.',
    });
    const prefix = createHash('sha256').update(SIDEDOOR_STATE_ID).digest('hex');
    const reopenOutbox = () =>
      sottoTransaction(instance.database, async (tx) => {
        const id = `sd-j:1:${prefix}:${queued.operation.id}`;
        const record = await tx.sidedoorState.findUniqueOrThrow({ where: { id } });
        if (!record.state || typeof record.state !== 'object' || Array.isArray(record.state))
          throw new Error('Writing outbox record missing');
        await tx.sidedoorState.update({
          where: { id },
          data: { state: { ...record.state, complete: false } },
        });
        await tx.sidedoorState.create({
          data: {
            id: `sd-ji:1:${prefix}:${queued.operation.id}`,
            revision: randomUUID(),
            state: {
              kind: 'outbox_pending',
              namespace: SIDEDOOR_STATE_ID,
              id: queued.operation.id,
              fingerprint: queued.operation.fingerprint,
            },
          },
        });
      });
    await reopenOutbox();
    await runQueuedAssessmentWriting(job);
    expect(writingDispatches).toBe(1);
    expect(
      await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).receipt(queued.operation.id)
      )
    ).toMatchObject({ status: 'complete' });
    await reopenOutbox();
    await job.remove();
    await worker.close();
    const failingWorker = new Worker(
      'learning-writing',
      async () => {
        throw new Error('Synthetic terminal delivery failure');
      },
      {
        connection: {
          host: url.hostname,
          port: Number(url.port),
          maxRetriesPerRequest: null,
        },
      }
    );
    try {
      const failed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Writing delivery did not fail')), 30000);
        failingWorker.on('failed', (item) => {
          if (item?.id === queued.operation.id) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      await deliverSottoJob({
        database: instance.database,
        queue,
        operationId: queued.operation.id,
        fingerprint: queued.operation.fingerprint,
        version: 3,
      });
      await failed;
      const { reconcileSottoJobs } = await import('@/lib/sidedoor/jobs/core/job-reconciliation');
      const page = await reconcileSottoJobs({
        database: instance.database,
        queues: new Map([[queue.name, queue]]),
        signal: new AbortController().signal,
        cursor: null,
      });
      expect(page.results.find((item) => item.id === queued.operation.id)).toMatchObject({
        status: 'complete',
      });
      expect(writingDispatches).toBe(1);
    } finally {
      await failingWorker.close();
      await (await queue.getJob(queued.operation.id))?.remove();
    }
    const { inspectPrerequisiteDeletion, admitPrerequisiteClassDeletion } =
      await import('@/lib/classes/help/prerequisite-deletion');
    const backend = await capturedLocalBackend(
      await LocalStorageCleanup.capture(root),
      root,
      LOCAL_STORAGE_URL_PREFIX,
      () => {}
    );
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        const id = `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${queued.operation.id}`;
        const claim = await tx.sidedoorState.findUniqueOrThrow({ where: { id } });
        if (!claim.state || typeof claim.state !== 'object' || Array.isArray(claim.state))
          throw new Error('Writing launch claim missing');
        await tx.sidedoorState.update({
          where: { id },
          data: { state: { ...claim.state, fingerprint: 'changed' } },
        });
        await expect(
          inspectPrerequisiteDeletion(tx, classId, cls.courseId, identity.ownerId)
        ).rejects.toThrow();
        throw new Error('Roll back altered writing claim');
      })
    ).rejects.toThrow('Roll back altered writing claim');
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        const inventory = await inspectPrerequisiteDeletion(
          tx,
          classId,
          cls.courseId,
          identity.ownerId
        );
        expect(inventory.writingOperations).toContainEqual({
          id: queued.operation.id,
          fingerprint: queued.operation.fingerprint,
          version: 3,
        });
        await admitPrerequisiteClassDeletion(tx, inventory, backend);
        await tx.courseClass.delete({ where: { id: classId } });
        expect(await sottoJobOutbox(tx).receipt(queued.operation.id)).toMatchObject({
          status: 'erased',
        });
        throw new Error('Roll back queued writing deletion');
      })
    ).rejects.toThrow('Roll back queued writing deletion');
    expect(await (await readWritingHttp(identity.ownerToken)).json()).toEqual({
      status: 'COMPLETED',
      text: 'Мой ответ.',
    });
    const expiredPrompt = writingSection.items[1];
    if (!expiredPrompt) throw new Error('Second writing prompt missing');
    const expiredCapture = await writingTask(expiredPrompt.id);
    const expired = await sottoTransaction(instance.database, (tx) =>
      admitAssessmentWriting(tx, {
        classId,
        assessmentId: fence.assessmentId,
        promptId: expiredPrompt.id,
        text: 'Другой ответ.',
        execution,
        selection,
        expected: expiredCapture,
        queued: true,
      })
    );
    const expiredJob = {
      id: expired.operation.id,
      name: 'learning-writing.v3',
      data: {
        operationId: expired.operation.id,
        fingerprint: expired.operation.fingerprint,
      },
    } as import('bullmq').Job<unknown>;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expired.operation.expiresAt + 1);
    try {
      await expect(runQueuedAssessmentWriting(expiredJob)).rejects.toThrow();
    } finally {
      clock.mockRestore();
    }
    expect(writingDispatches).toBe(1);
    expect(await (await readWritingHttp(identity.ownerToken, expiredPrompt.id)).json()).toEqual({
      status: 'UNRESOLVED',
      text: 'Другой ответ.',
    });
    const { settleQueuedAssessmentWritingReceipt } =
      await import('@/lib/learning/classes/writing/assessment-writing-run');
    expect(
      await sottoTransaction(instance.database, (tx) =>
        settleQueuedAssessmentWritingReceipt(tx, {
          operationId: expired.operation.id,
          fingerprint: expired.operation.fingerprint,
        })
      )
    ).toBe(false);
    expect(
      await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).receipt(expired.operation.id)
      )
    ).toMatchObject({ status: 'pending' });
    expect(writingDispatches).toBe(1);
  } finally {
    if (timer) clearTimeout(timer);
    await worker.close();
    await queue.close();
  }
  return;
}
