import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';
import {
  captureReviewFirstWorkerEvidence,
  inspectReviewFirstWorker,
  inspectReviewContinuation,
  inspectReviewPausedFirstWorker,
  inspectReviewPausedConsumers,
  inspectReviewRedisEmpty,
  prepareReviewQueues,
  type ReviewQueueRuntime,
} from '../first-worker';
import { runReviewReadiness } from '../readiness';
import { REVIEW_WORKLOAD_TIMEOUT_MS, runReviewWorkloads } from './workload';
import { inspectReviewQueuePolicy, reviewRuntimePolicySchema } from './policy/queues';
import { ALL_QUEUE_NAMES } from '../../../../apps/web/src/lib/queue';
import { prismaUnfiltered } from '../../../../apps/web/src/lib/prisma';
import { SIDEDOOR_STATE_ID } from '../../../../apps/web/src/lib/sidedoor/access/state/store';
import { sottoJobOutbox } from '../../../../apps/web/src/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '../../../../apps/web/src/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  isSottoSynchronousJob,
  requireSottoJobVersion,
} from '../../../../apps/web/src/lib/sidedoor/jobs/core/job-contracts';

const initialSchema = z
  .object({
    mode: z.enum([
      'capture',
      'inspect',
      'prepare',
      'providers',
      'queues',
      'continuation',
      'consumers',
      'workloads',
      'paused-admission',
      'queue-policy',
    ]),
    input: z.unknown(),
    checkpoint: z.unknown().optional(),
    policy: z.unknown().optional(),
  })
  .strict();
const ackSchema = z.object({ type: z.literal('ack'), id: z.number().int().positive() }).strict();
const prefix = 'SOTTO_REVIEW_IPC=';
const load = createRequire(import.meta.url);
const lifecycle = load('../../queue-lifecycle.cjs') as {
  connectionIdentity(environment: NodeJS.ProcessEnv, namespace: string): string;
  run(input: unknown, runtime: unknown): Promise<unknown>;
};

/** Only the parent can acknowledge its independently checked fence and durable journal. */
export async function main(): Promise<void> {
  const controller = new AbortController();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const reader = lines[Symbol.asyncIterator]();
  const initialTimer = setTimeout(() => {
    controller.abort(new Error('Review input deadline expired'));
    lines.close();
    process.stdin.destroy();
  }, 90_000);
  const first = await reader.next();
  clearTimeout(initialTimer);
  assert(
    !first.done && Buffer.byteLength(first.value) <= 262_144,
    'Bounded private input required'
  );
  const initial = initialSchema.parse(JSON.parse(first.value));
  if (initial.policy !== undefined) reviewRuntimePolicySchema.parse(initial.policy);
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let sequence = 0;
  let completed = false;
  const emit = (value: unknown) => process.stdout.write(prefix + JSON.stringify(value) + '\n');
  const fail = () => {
    controller.abort(new Error('Review controller disconnected'));
    for (const request of pending.values())
      request.reject(new Error('Review acknowledgement missing'));
    pending.clear();
  };
  const acknowledgements = (async () => {
    try {
      for (;;) {
        const line = await reader.next();
        if (line.done) break;
        assert(Buffer.byteLength(line.value) <= 1024, 'Bounded acknowledgement required');
        const ack = ackSchema.parse(JSON.parse(line.value));
        const waiting = pending.get(ack.id);
        assert(waiting, 'Unexpected review acknowledgement');
        pending.delete(ack.id);
        waiting.resolve();
      }
    } finally {
      if (!completed) fail();
    }
  })();
  acknowledgements.catch(fail);
  const request = async (type: string, value?: unknown) => {
    controller.signal.throwIfAborted();
    assert(++sequence <= 100, 'Review acknowledgement count exceeded');
    const id = sequence;
    await new Promise<void>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      emit({ type, id, ...(value === undefined ? {} : { value }) });
    });
    controller.signal.throwIfAborted();
  };
  const timer = setTimeout(
    () => {
      fail();
      lines.close();
      process.stdin.destroy();
    },
    initial.mode === 'workloads'
      ? REVIEW_WORKLOAD_TIMEOUT_MS + 10_000
      : initial.mode === 'providers'
        ? 310_000
        : 90_000
  );
  let redis: Redis | null = null;
  try {
    let result: unknown;
    if (initial.mode === 'capture') {
      result = await captureReviewFirstWorkerEvidence(prismaUnfiltered, initial.input);
    } else if (initial.mode === 'providers') {
      result = await runReviewReadiness(initial.input, initial.checkpoint, {
        signal: controller.signal,
        assertFence: () => request('fence'),
        persistCheckpoint: (checkpoint) => request('checkpoint', checkpoint),
      });
    } else if (initial.mode === 'workloads') {
      result = await runReviewWorkloads(initial.input, initial.checkpoint, {
        signal: controller.signal,
        assertFence: () => request('fence'),
        persistCheckpoint: (checkpoint) => request('workloadCheckpoint', checkpoint),
      });
    } else {
      assert(
        process.env.DATABASE_URL && process.env.REDIS_URL,
        'Explicit review connections required'
      );
      redis = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        commandTimeout: 5000,
        connectTimeout: 5000,
        retryStrategy: () => null,
        maxRetriesPerRequest: 0,
      });
      redis.on('error', () => undefined);
      const connection = redis;
      const queueRuntime: ReviewQueueRuntime = {
        database: prismaUnfiltered,
        namespace: SIDEDOOR_STATE_ID,
        names: ALL_QUEUE_NAMES,
        environment: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,
          REDIS_URL: process.env.REDIS_URL,
        },
        createQueue: (name: string) => new Queue(name, { connection, skipMetasUpdate: true }),
        policy: reviewRuntimePolicySchema.parse(initial.policy),
        policyIntent: null,
        admitQueuePolicy: (intent) => request('queuePolicyIntent', intent),
      };
      const runtime = {
        ...queueRuntime,
        sottoJobOutbox,
        sottoJobExecutions,
        isSottoSynchronousJob,
        requireSottoJobVersion,
      };
      await request(initial.mode === 'queue-policy' ? 'policyCheck' : 'fence');
      if (initial.mode === 'queue-policy') {
        result = await inspectReviewQueuePolicy(queueRuntime, initial.input, false);
      } else if (initial.mode === 'inspect') {
        result = await inspectReviewFirstWorker(prismaUnfiltered, initial.input);
      } else if (initial.mode === 'prepare') {
        const input = z
          .strictObject({ evidence: z.unknown(), policyIntent: z.unknown() })
          .parse(initial.input);
        runtime.policyIntent = input.policyIntent;
        if (input.policyIntent === null) {
          await inspectReviewRedisEmpty(redis);
          await request('queueManifest', {
            schemaVersion: 1,
            connectionIdentity: lifecycle.connectionIdentity(process.env, SIDEDOOR_STATE_ID),
            queues: [...ALL_QUEUE_NAMES].sort().map((name) => ({ name, paused: false })),
          });
        }
        result = await prepareReviewQueues(runtime, input.evidence, redis);
      } else if (initial.mode === 'continuation') {
        const queue = runtime.createQueue('worksheet-pdf');
        try {
          result = await inspectReviewContinuation(prismaUnfiltered, initial.input, queue);
        } finally {
          await queue.close();
        }
      } else if (initial.mode === 'consumers') {
        result = await inspectReviewPausedConsumers(runtime, initial.input);
      } else if (initial.mode === 'paused-admission') {
        const consumers = { address: '172.30.99.11', paused: true, count: 1 };
        await inspectReviewPausedConsumers(runtime, consumers);
        result = await inspectReviewPausedFirstWorker(prismaUnfiltered, initial.input);
        await inspectReviewPausedConsumers(runtime, consumers);
      } else {
        result = await lifecycle.run(initial.input, runtime);
      }
    }
    if (initial.mode !== 'capture')
      await request(initial.mode === 'queue-policy' ? 'policyCheck' : 'fence');
    emit({ type: 'result', value: result });
    completed = true;
  } finally {
    clearTimeout(timer);
    completed = true;
    lines.close();
    await reader.return?.();
    await acknowledgements.catch(() => undefined);
    redis?.disconnect();
    await prismaUnfiltered.$disconnect();
  }
}
