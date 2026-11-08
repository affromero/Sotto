import { expect, vi, type Mock } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { SharedTestInstance } from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

interface AudioWaitContext {
  instance: SharedTestInstance;
  audioQueue: typeof import('@/lib/queue') | undefined;
  boundary: { execution: SottoProviderExecution | null };
  provider: { generate: Mock };
  operation: { id: string; fingerprint: string };
  record: { job: { payload: unknown } };
}

export async function checkAssessmentAudioWait({
  instance,
  audioQueue,
  boundary,
  provider,
  operation,
  record,
}: AudioWaitContext) {
  if (!audioQueue) return;
  let dispatches = 0;
  provider.generate.mockImplementation(
    async (_system: string, messages: Array<{ content: string }>) => {
      const { skill, count } = JSON.parse(messages[0]!.content) as {
        skill: string;
        count: number;
      };
      const questions = Array.from({ length: count }, (_, index) => ({
        question: `Independent ${skill} ${index}`,
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        explanation: 'Reason',
      }));
      const content =
        skill === 'READING'
          ? { skill, passage: 'Новый короткий текст.', items: questions }
          : skill === 'LISTENING'
            ? { skill, turns: [{ speaker: 'HOST', text: 'Добрый день' }], items: questions }
            : skill === 'SPEAKING'
              ? {
                  skill,
                  items: Array.from({ length: count }, (_, index) => ({
                    task: `Independent speaking ${index}`,
                    mode: 'COMMUNICATIVE',
                    translation: 'Palabra',
                    rubric: 'Criteria',
                    guidance: 'Guidance',
                  })),
                }
              : skill === 'WRITING'
                ? {
                    skill,
                    items: Array.from({ length: count }, (_, index) => ({
                      task: `Independent writing ${index}`,
                      rubric: 'Criteria',
                      guidance: 'Guidance',
                    })),
                  }
                : { skill, items: questions };
      const request = boundary.execution?.providerRequest;
      if (!request) throw new Error('Missing provider journal');
      const response = await request(
        new Request(`https://provider.example.test/${skill}`, {
          method: 'POST',
          body: skill,
        }),
        async () => {
          dispatches += 1;
          return Response.json({
            choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
          });
        }
      );
      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return {
        content: data.choices[0]!.message.content,
        model: 'fixture',
        inputTokens: 1,
        outputTokens: 1,
      };
    }
  );
  const root = await mkdtemp(join(tmpdir(), 'sotto-assessment-wait-'));
  const previousDirectory = process.env.SIDEDOOR_EXECUTION_DIR;
  vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
  const { Queue } = await import('bullmq');
  const { processInteraction } = await import('@/workers/interaction.worker');
  const { deliverSottoJob } = await import('@/lib/sidedoor/jobs/core/job-delivery');
  const url = new URL(process.env.SOTTO_TEST_PRIVATE_REDIS_URL!);
  const queue = new Queue('interactions', {
    connection: { host: url.hostname, port: Number(url.port), maxRetriesPerRequest: null },
  });
  const worker = audioQueue.createWorker<import('@/lib/queue').ProcessInteractionPayload>(
    'interactions',
    processInteraction,
    { concurrency: 1 }
  );
  let failure: Error | undefined;
  worker.on('failed', (item, error) => {
    if (item?.id === operation.id) failure = error;
  });
  try {
    await deliverSottoJob({
      database: instance.database,
      queue,
      operationId: operation.id,
      version: 6,
    });
    await expect
      .poll(
        async () => {
          if (failure) throw failure;
          const job = await queue.getJob(operation.id);
          return job && job.attemptsStarted >= 2 ? job.getState() : null;
        },
        { timeout: 30000 }
      )
      .toBe('delayed');
    expect(dispatches).toBe(5);
    expect(
      await instance.database.classAssessment.findUniqueOrThrow({
        where: { id: assessmentWorkSchema.parse(record.job.payload).fence.assessmentId },
      })
    ).toMatchObject({ status: 'GENERATING' });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(operation.id))
    ).toMatchObject({ status: 'pending', fingerprint: operation.fingerprint });
  } finally {
    await worker.close();
    await (await queue.getJob(operation.id))?.remove();
    await queue.close();
    if (previousDirectory === undefined) delete process.env.SIDEDOOR_EXECUTION_DIR;
    else process.env.SIDEDOOR_EXECUTION_DIR = previousDirectory;
    await rm(root, { recursive: true, force: true });
  }
  return;
}
