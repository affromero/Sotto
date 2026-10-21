import assert from 'node:assert/strict';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { ALL_QUEUE_NAMES } from '../../../../../apps/web/src/lib/queue';
import { privacyContactUrl } from '../../../../../apps/web/src/lib/privacy/contact';

export const reviewRuntimePolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    webHeapMiB: z.number().int().min(64).max(4096),
    workerHeapMiB: z.number().int().min(64).max(4096),
    helperHeapMiB: z.number().int().min(64).max(4096),
    queueConcurrency: z.literal(1),
    privacyContactEmail: z.string().min(1).max(254),
  })
  .superRefine((value, context) => {
    try {
      if (!privacyContactUrl(value.privacyContactEmail)) throw new Error('Contact required');
    } catch {
      context.addIssue({ code: 'custom', message: 'Valid public operator contact required' });
    }
  });

const reviewQueuePolicyIntentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  queues: z.array(
    z.strictObject({ name: z.string(), originalConcurrency: z.null(), concurrency: z.literal(1) })
  ),
});
export type ReviewQueuePolicyIntent = z.infer<typeof reviewQueuePolicyIntentSchema>;
type Runtime = { names: readonly string[]; createQueue(name: string): Queue };

function names(runtime: Runtime): string[] {
  const expected = [...ALL_QUEUE_NAMES].sort();
  assert.deepEqual([...runtime.names].sort(), expected, 'Exact review queue inventory required');
  return expected;
}

/** Public completion checks read metadata only, regardless of active work or pause flags. */
export async function inspectReviewQueuePolicy(runtime: Runtime, value: unknown, paused?: boolean) {
  const policy = reviewRuntimePolicySchema.parse(value);
  const deadline = Date.now() + 15_000;
  const expected = names(runtime);
  for (const name of expected) {
    assert(Date.now() < deadline, 'Review queue policy inspection deadline');
    const queue = runtime.createQueue(name);
    try {
      assert.equal(queue.opts.skipMetasUpdate, true, 'Metadata-free queue construction required');
      assert.equal(
        await queue.getGlobalConcurrency(),
        policy.queueConcurrency,
        'Admitted review queue concurrency changed'
      );
      if (paused !== undefined)
        assert.equal(await queue.isPaused(), paused, 'Admitted review queue pause flags changed');
    } finally {
      await queue.close();
    }
  }
  return {
    queueCount: expected.length,
    concurrency: policy.queueConcurrency,
    privacyContactEmail: policy.privacyContactEmail,
  };
}

/** The caller durably admits the original null readback before the first canonical write. */
export async function prepareReviewQueuePolicy(
  queues: readonly Queue[],
  connectionIdentity: string,
  retained: unknown,
  admit: (intent: ReviewQueuePolicyIntent) => Promise<void>
) {
  const expected = [...ALL_QUEUE_NAMES].sort();
  assert.deepEqual(queues.map((queue) => queue.name).sort(), expected);
  const intent = reviewQueuePolicyIntentSchema.parse({
    schemaVersion: 1,
    connectionIdentity,
    queues: expected.map((name) => ({ name, originalConcurrency: null, concurrency: 1 })),
  });
  if (retained !== null) assert.deepEqual(reviewQueuePolicyIntentSchema.parse(retained), intent);
  const deadline = Date.now() + 15_000;
  for (const queue of queues) {
    assert(Date.now() < deadline, 'Review queue policy preparation deadline');
    assert(await queue.isPaused(), 'Review queues must remain paused');
    assert.equal((await queue.getWorkers()).length, 0, 'Review queue consumer appeared');
    assert.equal(await queue.getActiveCount(), 0, 'Review queue work appeared');
    assert.equal(await queue.getGlobalRateLimit(), null, 'Unknown review rate-limit metadata');
    const current = await queue.getGlobalConcurrency();
    assert(
      current === null || (retained !== null && current === 1),
      'Unknown original review queue concurrency'
    );
  }
  if (retained === null) await admit(intent);
  for (const queue of queues) {
    assert(Date.now() < deadline, 'Review queue policy preparation deadline');
    assert(await queue.isPaused(), 'Review queues must remain paused');
    assert.equal((await queue.getWorkers()).length, 0, 'Review queue consumer appeared');
    assert.equal(await queue.getActiveCount(), 0, 'Review queue work appeared');
    assert.equal(await queue.getGlobalRateLimit(), null, 'Unknown review rate-limit metadata');
    const current = await queue.getGlobalConcurrency();
    assert(current === null || (retained !== null && current === 1), 'Unknown review concurrency');
    if (current === null) await queue.setGlobalConcurrency(1);
    assert.equal(await queue.getGlobalConcurrency(), 1, 'Review queue concurrency not retained');
  }
  return intent;
}
