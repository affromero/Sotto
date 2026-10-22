import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import type { TimerOptions } from 'node:timers';
import timers from 'node:timers/promises';
import type { ReviewWorkloadCheckpoint } from '../../../../../scripts/deploy/review/runtime/workload';

export interface WorkloadChildSummary {
  type: 'summary';
  pollDelays: number;
  elapsed: number;
  requests: string[];
  mutations: { path: string; profile: string; body: unknown }[];
  checkpoint: ReviewWorkloadCheckpoint | null;
}

async function main(): Promise<void> {
  const load = createRequire(__filename);
  const startedAt = Date.now();
  let now = startedAt;
  let pollDelays = 0;
  const realDelay = timers.setTimeout;
  mock.method(Date, 'now', () => now);
  mock.method(
    timers,
    'setTimeout',
    (milliseconds: number, value: unknown, options?: TimerOptions) => {
      if (milliseconds === 5000) {
        now += milliseconds;
        pollDelays++;
        return realDelay(0, value, options);
      }
      return realDelay(milliseconds, value, options);
    }
  );
  syncBuiltinESMExports();
  const { fixture } = load('./fixture.ts') as typeof import('./fixture');
  const { reviewWorkloadCheckpointSchema } = load(
    '../../../../../scripts/deploy/review/runtime/workload.ts'
  ) as typeof import('../../../../../scripts/deploy/review/runtime/workload');
  const f = fixture({ pendingGenerationPolls: 110 });
  mock.method(globalThis, 'fetch', f.boundary.fetch);
  const send = process.send?.bind(process);
  assert(send, 'Parent fixture IPC required');
  process.on('message', (message: { id: number; checkpoint: unknown }) => {
    f.replaceCheckpoint(reviewWorkloadCheckpointSchema.parse(message.checkpoint));
    send({ type: 'checkpointStored', id: message.id });
  });
  const channel = load(
    '../../../../../scripts/deploy/review/runtime/channel.ts'
  ) as typeof import('../../../../../scripts/deploy/review/runtime/channel');
  await channel.main();
  const summary: WorkloadChildSummary = {
    type: 'summary',
    pollDelays,
    elapsed: now - startedAt,
    requests: f.requests,
    mutations: f.mutations,
    checkpoint: f.checkpoint(),
  };
  send(summary);
  process.disconnect?.();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
